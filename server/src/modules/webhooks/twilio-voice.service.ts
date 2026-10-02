import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CONVERSATION_RELAY_PATH } from '../voice/conversation-relay.service';
import {
  applyCampaignDisposition,
  dispositionFromTwilioStatus,
} from '../voice/campaign-disposition.util';

const VOICEMAIL_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Polly.Camila">No momento não podemos atender. Deixe seu recado após o sinal.</Say>
  <Record maxLength="120" playBeep="true" />
  <Hangup/>
</Response>`;

const BUSY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="pt-BR" voice="Polly.Camila">Desculpe, todos os atendentes estão ocupados.</Say><Hangup/></Response>`;

const DEFAULT_VOICE_ID = () =>
  process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? 'UgBBYS2sOqTuMpoF3BR0';

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return c;
    }
  });
}

/**
 * Ported from supabase/functions/twilio-incoming/index.ts. Resolves the
 * inbound/outbound-api call to a phone_number + persona, writes/finds the
 * voice_calls row, and builds the TwiML that tells Twilio how to handle it.
 *
 * The ConversationRelay fallback path points at our own
 * ConversationRelayService (ws server attached in main.ts), not the
 * Supabase-hosted function anymore.
 *
 * Both call sites are `@Public()` webhooks — no `TenantTxHost` ever
 * exists here, so all table access goes through SECURITY DEFINER
 * wrappers. See migrations/20260720240000-TwilioVoiceIngestBypass.ts.
 */
@Injectable()
export class TwilioVoiceService {
  private readonly logger = new Logger(TwilioVoiceService.name);

  constructor(private readonly dataSource: DataSource) {}

  async handleIncoming(form: Record<string, string>): Promise<string> {
    const callSid = form.CallSid ?? '';
    const from = form.From ?? '';
    const to = form.To ?? '';
    const direction = form.Direction ?? 'inbound';
    const ownE164 = direction.startsWith('outbound') ? from : to;

    this.logger.log(
      `callSid=${callSid} direction=${direction} from=${from} to=${to} ownE164=${ownE164}`,
    );

    const phoneNumberRows = await this.dataSource.query<
      {
        id: string;
        account_id: string;
        pinned_persona_id: string | null;
        inbound_behavior: string;
        enabled: boolean;
        provider_config: Record<string, unknown>;
      }[]
    >(`SELECT * FROM public.twilio_phone_number_resolve($1)`, [ownE164]);
    const phoneNumber = phoneNumberRows[0];

    if (!phoneNumber || !phoneNumber.enabled) {
      return BUSY_TWIML;
    }

    let callId: string;
    if (direction.startsWith('outbound')) {
      const existingRows = await this.dataSource.query<{ id: string }[]>(
        `SELECT * FROM public.voice_call_get_by_provider_sid($1)`,
        [callSid],
      );
      callId =
        existingRows[0]?.id ??
        (await this.createCall(phoneNumber, callSid, from, to, direction));
    } else {
      callId = await this.createCall(phoneNumber, callSid, from, to, direction);
    }

    const cfg = phoneNumber.provider_config ?? {};
    const forwardTo = typeof cfg.forward_to === 'string' ? cfg.forward_to : '';

    let voiceId = DEFAULT_VOICE_ID();
    if (typeof cfg.voice_id === 'string' && cfg.voice_id)
      voiceId = cfg.voice_id;
    let welcomeGreeting = 'Olá, em que posso ajudar?';
    let elAgentId: string | null = null;

    if (phoneNumber.pinned_persona_id) {
      const personaRows = await this.dataSource.query<
        {
          name: string;
          voice_clone_id: string | null;
          voice_provider: string | null;
          elevenlabs_agent_id: string | null;
        }[]
      >(`SELECT * FROM public.agent_persona_get_voice_info($1)`, [
        phoneNumber.pinned_persona_id,
      ]);
      const persona = personaRows[0];
      if (persona) {
        if (persona.voice_provider === 'elevenlabs' && persona.voice_clone_id) {
          voiceId = persona.voice_clone_id;
        }
        if (persona.name)
          welcomeGreeting = `Olá! Aqui é ${persona.name}. Em que posso ajudar?`;
        elAgentId = persona.elevenlabs_agent_id ?? null;
      }
    }

    switch (phoneNumber.inbound_behavior) {
      case 'ai_answer':
      case 'suggest': {
        if (elAgentId) {
          return this.buildElTwiML(elAgentId, from, callId);
        }
        return this.buildConversationRelayTwiML(
          callId,
          phoneNumber.pinned_persona_id,
          voiceId,
          welcomeGreeting,
        );
      }
      case 'forward_to_agent':
        return forwardTo ? this.buildForwardTwiML(forwardTo) : VOICEMAIL_TWIML;
      case 'voicemail':
      default:
        return VOICEMAIL_TWIML;
    }
  }

  private async createCall(
    phoneNumber: {
      id: string;
      account_id: string;
      pinned_persona_id: string | null;
    },
    callSid: string,
    from: string,
    to: string,
    direction: string,
  ): Promise<string> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.voice_call_create_from_twilio($1, $2, $3, $4, $5, $6, $7)`,
      [
        phoneNumber.account_id,
        phoneNumber.id,
        phoneNumber.pinned_persona_id,
        direction.startsWith('outbound') ? 'outbound' : 'inbound',
        callSid,
        from,
        to,
      ],
    );
    return rows[0].id;
  }

  private async buildElTwiML(
    elAgentId: string,
    from: string,
    callId: string,
  ): Promise<string> {
    const apiKey = process.env.ELEVENLABS_API_KEY ?? '';
    if (!apiKey) {
      this.logger.warn('ELEVENLABS_API_KEY not set');
      return VOICEMAIL_TWIML;
    }
    try {
      const signedRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(elAgentId)}`,
        { headers: { 'xi-api-key': apiKey } },
      );
      if (!signedRes.ok) {
        const txt = await signedRes.text().catch(() => '');
        this.logger.error(
          `EL get_signed_url failed ${signedRes.status}: ${txt.slice(0, 300)}`,
        );
        return VOICEMAIL_TWIML;
      }
      const signed = (await signedRes.json().catch(() => null)) as {
        signed_url?: string;
        url?: string;
      } | null;
      const wssUrl = signed?.signed_url ?? signed?.url;
      if (!wssUrl) {
        this.logger.warn(
          `EL get_signed_url shape unexpected: ${JSON.stringify(signed).slice(0, 200)}`,
        );
        return VOICEMAIL_TWIML;
      }
      return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wssUrl)}">
      <Parameter name="agent_id" value="${escapeXml(elAgentId)}"/>
      <Parameter name="call_id" value="${escapeXml(callId)}"/>
      <Parameter name="caller_id" value="${escapeXml(from)}"/>
    </Stream>
  </Connect>
</Response>`;
    } catch (err) {
      this.logger.error('EL buildTwiML exception', err as Error);
      return VOICEMAIL_TWIML;
    }
  }

  private buildConversationRelayTwiML(
    callId: string,
    personaId: string | null,
    voiceId: string,
    welcomeGreeting: string,
  ): string {
    const base = (process.env.PUBLIC_API_URL ?? '')
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
    if (!base) return VOICEMAIL_TWIML;
    const wsUrl = `wss://${base}${CONVERSATION_RELAY_PATH}?callId=${encodeURIComponent(callId)}`;
    const greet = escapeXml(welcomeGreeting);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      welcomeGreeting="${greet}"
      ttsProvider="ElevenLabs"
      transcriptionProvider="Deepgram"
      voice="${voiceId}"
      language="pt-BR"
      ttsLanguage="pt-BR"
      transcriptionLanguage="pt-BR"
      speechModel="nova-3-general"
      interruptible="any"
      dtmfDetection="true">
      <Parameter name="callId" value="${callId}"/>
      ${personaId ? `<Parameter name="personaId" value="${personaId}"/>` : ''}
    </ConversationRelay>
  </Connect>
</Response>`;
  }

  private buildForwardTwiML(forwardTo: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR" voice="Polly.Camila">Transferindo sua ligação, um momento.</Say>
  <Dial timeout="30">${forwardTo}</Dial>
</Response>`;
  }

  async handleStatus(form: Record<string, string>): Promise<void> {
    const STATUS_MAP: Record<string, string> = {
      queued: 'queued',
      initiated: 'queued',
      ringing: 'ringing',
      'in-progress': 'in_progress',
      completed: 'completed',
      busy: 'busy',
      failed: 'failed',
      'no-answer': 'no_answer',
      canceled: 'canceled',
    };
    const callSid = form.CallSid ?? '';
    if (!callSid) return;
    const callStatus = form.CallStatus ?? '';
    const duration = parseInt(form.CallDuration ?? '0', 10);
    const recordingUrl = form.RecordingUrl;
    const mapped = STATUS_MAP[callStatus] ?? 'in_progress';
    const terminal = [
      'completed',
      'failed',
      'busy',
      'no_answer',
      'canceled',
    ].includes(mapped);

    const updatedRows = await this.dataSource.query<
      {
        id: string;
        recording_storage_path: string | null;
        transcription_status: string | null;
      }[]
    >(
      `SELECT * FROM public.voice_call_update_status_by_sid($1, $2, $3, $4, $5)`,
      [callSid, mapped, duration, recordingUrl ?? null, terminal],
    );
    const updated = updatedRows[0];

    // Propaga o desfecho para o contato de campanha. Sem isto o status parava
    // em voice_calls e a campanha nunca sabia se o cliente atendeu, recusou ou
    // não completou — o contato ficava em 'placed' indefinidamente.
    if (updated && terminal) {
      const linkRows = await this.dataSource.query<
        { campaign_contact_id: string | null }[]
      >(
        `SELECT metadata->>'campaign_contact_id' AS campaign_contact_id
           FROM voice_calls WHERE id = $1 LIMIT 1`,
        [updated.id],
      );
      await applyCampaignDisposition(
        this.dataSource,
        linkRows[0]?.campaign_contact_id,
        dispositionFromTwilioStatus(mapped, duration, form.AnsweredBy),
        duration,
      );
    }

    // Persiste o resultado do AMD da Twilio (AnsweredBy) no metadata — útil
    // para auditoria pós-chamada (distingue humano de máquina, secretária, etc).
    // Só grava quando presente para não inflar metadata com nulos.
    const answeredBy = form.AnsweredBy;
    if (updated && answeredBy) {
      await this.dataSource.query(
        `UPDATE voice_calls
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('answered_by', $2::text)
         WHERE id = $1`,
        [updated.id, answeredBy],
      );
    }

    if (
      updated &&
      recordingUrl &&
      !updated.recording_storage_path &&
      updated.transcription_status === 'idle'
    ) {
      await this.dataSource.query(
        `SELECT public.voice_call_set_transcription_status($1, 'pending')`,
        [updated.id],
      );
    }
  }
}
