// WebSocket handler for Twilio <ConversationRelay>.
//
// Twilio hosts STT (Deepgram) and TTS (ElevenLabs) on their side; our edge
// function only sees transcribed text turns and streams back LLM tokens.
// That lets the whole voice stack live inside Supabase — no external
// relay server needed (Fly/etc.), which keeps the Lovable Remix story clean.
//
// Protocol (https://www.twilio.com/docs/voice/twiml/connect/conversationrelay):
//   Twilio → us:  { type: "setup" | "prompt" | "interrupt" | "dtmf" | "error" }
//   us → Twilio:  { type: "text" | "switch_language" | "end_session" }
//
// Auth: WebSocket URL carries `callId` query param; we validate it matches a
// real voice_calls row in "ringing"/"queued"/"in-progress". No cross-tenant
// access possible — all persona/account data is loaded from that row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const CONTEXT_TURNS = 6;

Deno.serve((req) => {
  const upgrade = req.headers.get("upgrade") ?? "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("expected WebSocket", { status: 426 });
  }
  const url = new URL(req.url);
  const callId = url.searchParams.get("callId") ?? "";
  if (!callId) {
    return new Response("callId required", { status: 400 });
  }

  console.log(`[conversation-relay] upgrade request for callId=${callId}`);
  const { socket, response } = Deno.upgradeWebSocket(req);
  handle(socket, callId).catch((err) => {
    console.error("[conversation-relay] handler crashed", err);
    try { socket.close(); } catch { /* ignore */ }
  });
  return response;
});

interface SessionState {
  sessionId: string;
  accountId: string;
  personaId: string | null;
  conversationId: string | null;
  systemPrompt: string;
  // Abort signal for the in-flight LLM call — cancelled when Twilio sends
  // `interrupt` so we stop spewing tokens the customer already talked over.
  currentAbort: AbortController | null;
}

async function handle(socket: WebSocket, callId: string) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Validate call + load context up front. Cheaper than hitting Supabase on
  // every turn, and lets us reject fake callIds before the WS session starts.
  const { data: call, error: callErr } = await supabase
    .from("voice_calls")
    .select("id, account_id, persona_id, conversation_id, status")
    .eq("id", callId)
    .maybeSingle();
  console.log(
    `[conversation-relay] call lookup callId=${callId} found=${!!call} err=${callErr?.message ?? "none"}`,
  );
  if (!call) {
    console.warn(`[conversation-relay] callId ${callId} not found — closing WS`);
    socket.close(1008, "call not found");
    return;
  }

  let systemPrompt =
    "You are a helpful customer service agent. Respond in the same language as the user. Keep replies under 2 sentences for voice.";
  if (call.persona_id) {
    const { data: persona } = await supabase
      .from("agent_personas")
      .select("system_prompt")
      .eq("id", call.persona_id)
      .maybeSingle();
    if (persona?.system_prompt) systemPrompt = persona.system_prompt;
  }

  const state: SessionState = {
    sessionId: "", // filled from first `setup` message
    accountId: call.account_id,
    personaId: call.persona_id,
    conversationId: call.conversation_id,
    systemPrompt,
    currentAbort: null,
  };

  socket.onopen = () => {
    console.log(
      `[conversation-relay] WS open callId=${callId} account=${state.accountId} persona=${state.personaId} conv=${state.conversationId} promptLen=${state.systemPrompt.length}`,
    );
  };

  socket.onmessage = async (evt) => {
    let msg: any;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
    } catch {
      return;
    }

    switch (msg.type) {
      case "setup":
        state.sessionId = msg.sessionId ?? "";
        console.log(
          `[conversation-relay] setup session=${state.sessionId} callSid=${msg.callSid} params=${JSON.stringify(msg.customParameters ?? {})}`,
        );
        break;

      case "prompt":
        console.log(
          `[conversation-relay] prompt isFinal=${msg.isFinal} lang=${msg.lang} transcript="${(msg.transcript ?? "").slice(0, 120)}"`,
        );
        if (!msg.isFinal) return;
        await handleTurn(supabase, socket, state, msg.transcript ?? "");
        break;

      case "interrupt":
        // Customer talked over the bot. Cancel the in-flight LLM so we stop
        // streaming tokens that won't be spoken anyway.
        state.currentAbort?.abort();
        state.currentAbort = null;
        break;

      case "dtmf":
        console.log(`[conversation-relay] dtmf=${msg.dtmf}`);
        // Future: route to IVR menu handler.
        break;

      case "error":
        console.error(
          `[conversation-relay] twilio error ${msg.code}: ${msg.message}`,
        );
        break;
    }
  };

  socket.onclose = (ev) => {
    state.currentAbort?.abort();
    console.log(
      `[conversation-relay] WS closed code=${ev.code} reason=${ev.reason}`,
    );
  };

  socket.onerror = (err) => {
    console.error("[conversation-relay] WS error", err);
  };
}

async function handleTurn(
  supabase: any,
  socket: WebSocket,
  state: SessionState,
  utterance: string,
) {
  if (!utterance.trim()) return;

  // Cancel any previous in-flight reply (safety — Twilio usually sends
  // `interrupt` first but this is the belt-and-suspenders).
  state.currentAbort?.abort();
  const ctrl = new AbortController();
  state.currentAbort = ctrl;

  // Persist the inbound utterance. Fire-and-forget — a failed insert shouldn't
  // block the LLM reply.
  if (state.conversationId) {
    supabase
      .from("messages")
      .insert({
        account_id: state.accountId,
        conversation_id: state.conversationId,
        content: utterance,
        content_type: 4,
        message_type: 0,
        sender_type: "Contact",
        content_attributes: { kind: "voice_transcript" },
      })
      .then(({ error }: any) => {
        if (error) console.warn("[turn] contact insert failed", error.message);
      });
  }

  // Load recent turns. Small window keeps the prompt tight for voice latency.
  let history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (state.conversationId) {
    const { data: recent } = await supabase
      .from("messages")
      .select("content, sender_type, created_at")
      .eq("conversation_id", state.conversationId)
      .eq("private", false)
      .order("created_at", { ascending: false })
      .limit(CONTEXT_TURNS);
    history = (recent ?? [])
      .reverse()
      .map((m: any) => ({
        role: (m.sender_type === "Contact" ? "user" : "assistant") as "user" | "assistant",
        content: m.content ?? "",
      }));
  }

  const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
  if (!lovableKey) {
    console.error("[conversation-relay] LOVABLE_API_KEY not set in env — ending session");
    sendText(socket, state, "Desculpe, configuração inválida. Ligação encerrada.");
    socket.send(
      JSON.stringify({ type: "end_session", sessionId: state.sessionId, handoffData: "{}" }),
    );
    return;
  }
  console.log(
    `[conversation-relay] starting LLM turn utteranceLen=${utterance.length} histLen=${history.length}`,
  );

  // Stream from the Lovable gateway. We forward each delta as a `text` token
  // so Twilio can start TTS while the LLM is still generating — critical for
  // keeping voice latency under ~1s.
  let fullReply = "";
  try {
    const res = await fetch(GATEWAY, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [
          { role: "system", content: state.systemPrompt },
          ...history,
          { role: "user", content: utterance },
        ],
        max_tokens: 150,
        temperature: 0.6,
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      console.error(`[turn] LLM ${res.status}: ${body.slice(0, 200)}`);
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      if (ctrl.signal.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      // Server-sent events: each message is `data: {...}\n\n`
      const events = buf.split("\n\n");
      buf = events.pop() ?? "";
      for (const raw of events) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const obj = JSON.parse(payload);
          const token = obj?.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token.length > 0) {
            fullReply += token;
            sendText(socket, state, token);
          }
        } catch { /* partial chunk */ }
      }
    }
  } catch (err) {
    if ((err as any)?.name !== "AbortError") {
      console.error("[turn] stream failed", err);
    }
  } finally {
    if (state.currentAbort === ctrl) state.currentAbort = null;
  }

  // Persist the full reply as a single AgentBot message (not per-token noise).
  if (fullReply && state.conversationId) {
    supabase
      .from("messages")
      .insert({
        account_id: state.accountId,
        conversation_id: state.conversationId,
        content: fullReply,
        content_type: 4,
        message_type: 1,
        sender_type: "AgentBot",
        sender_id: state.personaId,
        content_attributes: { kind: "voice_reply" },
      })
      .then(({ error }: any) => {
        if (error) console.warn("[turn] agent insert failed", error.message);
      });
  }
}

function sendText(socket: WebSocket, state: SessionState, token: string) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: "text",
      sessionId: state.sessionId,
      token,
      lang: "pt-BR",
    }),
  );
}
