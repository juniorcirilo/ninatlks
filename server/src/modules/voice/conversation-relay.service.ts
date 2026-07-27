import { Injectable, Logger } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'node:http';
import { DataSource } from 'typeorm';

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-2.5-flash';
const CONTEXT_TURNS = 6;
export const CONVERSATION_RELAY_PATH = '/webhooks/twilio/conversation-relay';

interface SessionState {
  sessionId: string;
  accountId: string;
  personaId: string | null;
  conversationId: string | null;
  systemPrompt: string;
  // Aborted when Twilio sends `interrupt` — stops streaming tokens the
  // customer already talked over.
  currentAbort: AbortController | null;
}

interface RelayMessage {
  type: 'setup' | 'prompt' | 'interrupt' | 'dtmf' | 'error';
  sessionId?: string;
  callSid?: string;
  customParameters?: Record<string, unknown>;
  isFinal?: boolean;
  lang?: string;
  transcript?: string;
  dtmf?: string;
  code?: number;
  message?: string;
}

/**
 * Ported from supabase/functions/twilio-conversation-relay/index.ts —
 * WebSocket handler for Twilio <ConversationRelay>. Twilio hosts STT
 * (Deepgram) and TTS (ElevenLabs) on THEIR side; this only sees
 * transcribed text turns and streams back LLM tokens as text — no raw
 * audio ever passes through here, so it's a plain JSON WebSocket relay,
 * not a media-streaming server.
 *
 * Attached directly to the underlying HTTP server (not a Nest
 * @WebSocketGateway) because the app already runs Socket.io on the same
 * server via RealtimeIoAdapter — a second `ws` server filtering on its
 * own path in the shared 'upgrade' event coexists safely (engine.io does
 * the same path-filtering internally), whereas two Nest WS adapters can't
 * both own upgrade handling.
 *
 * Auth: WS URL carries callId; validated against a real voice_calls row.
 * No cross-tenant access possible — persona/account context all loads
 * from that row.
 *
 * There is no HTTP-request path here at all (attached to the raw
 * `upgrade` event, outside Nest's interceptor chain), so every table
 * access goes through SECURITY DEFINER wrappers — see
 * migrations/20260720220000-ConversationRelayBypass.ts.
 */
@Injectable()
export class ConversationRelayService {
  private readonly logger = new Logger(ConversationRelayService.name);
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(private readonly dataSource: DataSource) {}

  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      if (url.pathname !== CONVERSATION_RELAY_PATH) return;
      const callId = url.searchParams.get('callId') ?? '';
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws, callId).catch((err: unknown) => {
          this.logger.error(`handler crashed callId=${callId}`, err as Error);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        });
      });
    });
    this.logger.log(
      `ConversationRelay WS attached at ${CONVERSATION_RELAY_PATH}`,
    );
  }

  private async handleConnection(
    socket: WebSocket,
    callId: string,
  ): Promise<void> {
    if (!callId) {
      socket.close(1008, 'callId required');
      return;
    }

    const callRows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        persona_id: string | null;
        conversation_id: string | null;
      }[]
    >(`SELECT * FROM public.voice_call_get($1)`, [callId]);
    const call = callRows[0];
    if (!call) {
      this.logger.warn(`callId ${callId} not found — closing WS`);
      socket.close(1008, 'call not found');
      return;
    }

    let systemPrompt =
      'You are a helpful customer service agent. Respond in the same language as the user. Keep replies under 2 sentences for voice.';
    if (call.persona_id) {
      const personaRows = await this.dataSource.query<
        { system_prompt: string | null }[]
      >(`SELECT * FROM public.agent_persona_get_system_prompt($1)`, [
        call.persona_id,
      ]);
      if (personaRows[0]?.system_prompt)
        systemPrompt = personaRows[0].system_prompt;
    }

    const state: SessionState = {
      sessionId: '',
      accountId: call.account_id,
      personaId: call.persona_id,
      conversationId: call.conversation_id,
      systemPrompt,
      currentAbort: null,
    };

    this.logger.log(
      `WS open callId=${callId} account=${state.accountId} persona=${state.personaId} conv=${state.conversationId}`,
    );

    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data).toString('utf8');
      void this.onMessage(socket, state, raw);
    });

    socket.on('close', (code, reason) => {
      state.currentAbort?.abort();
      this.logger.log(
        `WS closed callId=${callId} code=${code} reason=${reason.toString()}`,
      );
    });

    socket.on('error', (err) => {
      this.logger.error(`WS error callId=${callId}`, err);
    });
  }

  private async onMessage(
    socket: WebSocket,
    state: SessionState,
    raw: string,
  ): Promise<void> {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(raw) as RelayMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'setup':
        state.sessionId = msg.sessionId ?? '';
        this.logger.log(
          `setup session=${state.sessionId} callSid=${msg.callSid} params=${JSON.stringify(msg.customParameters ?? {})}`,
        );
        break;

      case 'prompt':
        if (!msg.isFinal) return;
        await this.handleTurn(socket, state, msg.transcript ?? '');
        break;

      case 'interrupt':
        state.currentAbort?.abort();
        state.currentAbort = null;
        break;

      case 'dtmf':
        this.logger.log(`dtmf=${msg.dtmf}`);
        break;

      case 'error':
        this.logger.error(`twilio error ${msg.code}: ${msg.message}`);
        break;
    }
  }

  private async handleTurn(
    socket: WebSocket,
    state: SessionState,
    utterance: string,
  ): Promise<void> {
    if (!utterance.trim()) return;

    state.currentAbort?.abort();
    const ctrl = new AbortController();
    state.currentAbort = ctrl;

    if (state.conversationId) {
      this.dataSource
        .query(
          `SELECT public.relay_insert_contact_message($1, $2, $3, $4::jsonb)`,
          [
            state.accountId,
            state.conversationId,
            utterance,
            JSON.stringify({ kind: 'voice_transcript' }),
          ],
        )
        .catch((err: unknown) =>
          this.logger.warn(`contact insert failed: ${String(err)}`),
        );
    }

    let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    if (state.conversationId) {
      const recent = await this.dataSource.query<
        { content: string | null; sender_type: string | null }[]
      >(`SELECT * FROM public.relay_get_recent_messages($1, $2)`, [
        state.conversationId,
        CONTEXT_TURNS,
      ]);
      history = recent.reverse().map((m) => ({
        role: m.sender_type === 'Contact' ? 'user' : 'assistant',
        content: m.content ?? '',
      }));
    }

    const lovableKey = process.env.LOVABLE_API_KEY ?? '';
    if (!lovableKey) {
      this.logger.error('LOVABLE_API_KEY not set — ending session');
      this.sendText(
        socket,
        state,
        'Desculpe, configuração inválida. Ligação encerrada.',
      );
      socket.send(
        JSON.stringify({
          type: 'end_session',
          sessionId: state.sessionId,
          handoffData: '{}',
        }),
      );
      return;
    }

    let fullReply = '';
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          messages: [
            { role: 'system', content: state.systemPrompt },
            ...history,
            { role: 'user', content: utterance },
          ],
          max_tokens: 150,
          temperature: 0.6,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => '');
        this.logger.error(`LLM ${res.status}: ${body.slice(0, 200)}`);
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        if (ctrl.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const raw of events) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as {
              choices?: [{ delta?: { content?: string } }];
            };
            const token = obj?.choices?.[0]?.delta?.content;
            if (typeof token === 'string' && token.length > 0) {
              fullReply += token;
              this.sendText(socket, state, token);
            }
          } catch {
            /* partial chunk */
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        this.logger.error('stream failed', err);
      }
    } finally {
      if (state.currentAbort === ctrl) state.currentAbort = null;
    }

    if (fullReply && state.conversationId) {
      this.dataSource
        .query(
          `SELECT public.relay_insert_agent_message($1, $2, $3, $4, $5::jsonb)`,
          [
            state.accountId,
            state.conversationId,
            fullReply,
            state.personaId,
            JSON.stringify({ kind: 'voice_reply' }),
          ],
        )
        .catch((err: unknown) =>
          this.logger.warn(`agent insert failed: ${String(err)}`),
        );
    }
  }

  private sendText(
    socket: WebSocket,
    state: SessionState,
    token: string,
  ): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: 'text',
        sessionId: state.sessionId,
        token,
        lang: 'pt-BR',
      }),
    );
  }
}
