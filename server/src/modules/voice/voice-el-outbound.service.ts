import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  ElevenLabsClientService,
  ElevenLabsCredentials,
} from '../elevenlabs/elevenlabs-client.service';
import { ElevenLabsConfigService } from '../elevenlabs/elevenlabs-config.service';
import { VoiceGuardService } from './voice-guard.service';
import {
  VoiceOutboundService,
  PlaceCallResult,
} from './voice-outbound.service';
import { buildSystemPromptWithGuardrails } from './sdr-guardrails.util';
import { PlaceCallDto } from './dto/place-call.dto';

const EL_TIMEOUT_MS = 15_000;
const PT_BR_LANGUAGE = 'pt';
const PT_BR_LANGUAGE_INSTRUCTION =
  '\n\n# IDIOMA DA LIGAÇÃO\n- Fale exclusivamente em português do Brasil (PT-BR).\n- Use vocabulário, tratamento e pronúncia naturais do Brasil; nunca use português de Portugal.\n- A primeira fala deve ser em português brasileiro.\n- Nunca cumprimente nem responda em inglês.';

interface OwnedPhoneNumber {
  id: string;
  account_id: string;
  e164: string;
  pinned_persona_id: string | null;
  elevenlabs_phone_number_id: string | null;
  inbox_id: string | null;
}

interface PersonaRow {
  elevenlabs_agent_id: string | null;
  name: string;
  system_prompt: string | null;
  first_message: string | null;
  voice_clone_id: string | null;
}

/**
 * Ported from supabase/functions/elevenlabs-outbound-call/index.ts — the
 * ElevenLabs-native outbound dialing path (agent handles STT/LLM/TTS
 * directly via api.elevenlabs.io/v1/convai/twilio/outbound-call). Falls
 * back to the Twilio-direct path (VoiceOutboundService, in-process — the
 * original made an HTTP loopback call to itself) on 5xx/timeout.
 */
@Injectable({ scope: Scope.REQUEST })
export class VoiceElOutboundService {
  private readonly logger = new Logger(VoiceElOutboundService.name);

  constructor(
    private readonly tx: TenantTxHost,
    private readonly guard: VoiceGuardService,
    private readonly elConfig: ElevenLabsConfigService,
    private readonly elClient: ElevenLabsClientService,
    private readonly twilioOutbound: VoiceOutboundService,
  ) {}

  async placeCall(
    accountId: string,
    userId: string,
    dto: PlaceCallDto,
  ): Promise<PlaceCallResult> {
    const phoneRows = await this.tx.manager.query<OwnedPhoneNumber[]>(
      `SELECT id, account_id, e164, pinned_persona_id, elevenlabs_phone_number_id, inbox_id
         FROM phone_numbers WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [dto.fromNumberId, accountId],
    );
    const pn = phoneRows[0];
    if (!pn) throw new NotFoundException('phone number not found');

    const guardResult = await this.guard.guardCall({
      accountId,
      toNumber: dto.toNumber,
    });
    if (!guardResult.allowed) {
      await this.guard.logAttempt({
        accountId,
        phoneNumber: dto.toNumber,
        contactId: dto.contactId,
        outcome: `blocked:${guardResult.reason}`,
      });
      return {
        ok: false,
        callId: '',
        via: 'twilio',
        reason: guardResult.reason,
        message: guardResult.message,
      };
    }
    const toE164 = guardResult.e164;

    const elPhoneId = pn.elevenlabs_phone_number_id;
    if (!elPhoneId) {
      throw new BadRequestException(
        "número não está ativado com ElevenLabs — clique em 'Ativar IA'",
      );
    }
    const personaId = dto.personaId ?? pn.pinned_persona_id;
    if (!personaId)
      throw new BadRequestException('nenhuma persona pinada neste número');

    const personaRows = await this.tx.manager.query<PersonaRow[]>(
      `SELECT elevenlabs_agent_id, name, system_prompt, first_message, voice_clone_id
         FROM agent_personas WHERE id = $1 LIMIT 1`,
      [personaId],
    );
    const persona = personaRows[0];
    const agentId = persona?.elevenlabs_agent_id ?? null;
    if (!agentId) {
      throw new BadRequestException(
        'persona não está sincronizada com EL — sincronize o agente primeiro',
      );
    }
    const personaName = persona?.name ?? 'Nina';
    const systemPrompt = `${buildSystemPromptWithGuardrails(persona?.system_prompt)}${PT_BR_LANGUAGE_INSTRUCTION}`;
    const firstMessage =
      persona?.first_message ??
      'Oi {{lead_name}}, aqui é {{agent_name}} da {{company_name}}. Esta chamada pode ser gravada. Em que posso ajudar?';

    const elCreds = await this.elConfig.loadAccountCreds(accountId);

    const preContactRows = await this.tx.manager.query<
      { name: string | null }[]
    >(
      `SELECT name FROM contacts WHERE account_id = $1 AND phone_number = $2 LIMIT 1`,
      [accountId, toE164],
    );
    const preLeadName = preContactRows[0]?.name?.trim() || null;

    const callRows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO voice_calls
         (account_id, phone_number_id, persona_id, direction, status, provider,
          from_number, to_number, started_at, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, 'outbound', 'queued', 'twilio', $4, $5, now(), $6::jsonb, now(), now())
       RETURNING id`,
      [
        accountId,
        pn.id,
        personaId,
        pn.e164,
        toE164,
        JSON.stringify({
          source: 'elevenlabs',
          initiated_by: userId,
          contact_id: dto.contactId ?? null,
          notes: dto.notes ?? null,
          meeting_id: dto.meetingId ?? null,
          call_purpose: dto.callPurpose ?? 'discovery',
          lead_name: preLeadName,
        }),
      ],
    );
    const callId = callRows[0].id;

    await this.linkConversation(accountId, pn, toE164, callId);
    const dynamicVariables = await this.buildDynamicVariables(
      accountId,
      personaName,
      toE164,
      dto,
      callId,
      preLeadName,
    );

    const { res, data, timedOut } = await this.callElevenLabs(elCreds, {
      agentId,
      elPhoneId,
      toE164,
      systemPrompt,
      firstMessage,
      voiceCloneId: persona?.voice_clone_id ?? undefined,
      dynamicVariables,
    });

    if (res.status >= 500 || timedOut) {
      return this.fallbackToTwilio(
        accountId,
        userId,
        dto,
        pn,
        personaId,
        toE164,
        callId,
        res.status,
        timedOut,
      );
    }

    if (!res.ok || data?.success === false) {
      // Return (never throw) once voice_calls has been written — an
      // exception here would roll back the whole per-request transaction
      // (TenantTxHost), discarding the row that call_attempts_log.voice_call_id
      // (written via raw DataSource, outside that transaction) already
      // references. Found by actually exercising this against a real
      // ElevenLabs 401.
      await this.tx.manager.query(
        `UPDATE voice_calls SET status = 'failed', metadata = metadata || $2::jsonb WHERE id = $1`,
        [callId, JSON.stringify({ error: data, source: 'elevenlabs' })],
      );
      await this.guard.logAttempt({
        accountId,
        phoneNumber: toE164,
        contactId: dto.contactId,
        voiceCallId: callId,
        outcome: `failed:el_${res.status}`,
      });
      return {
        ok: false,
        callId,
        via: 'elevenlabs',
        status: 'failed',
        reason: 'el_call_failed',
        message: `EL outbound failed: ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
      };
    }

    await this.tx.manager.query(
      `UPDATE voice_calls SET provider_call_sid = $2, source_id = $3, status = 'ringing' WHERE id = $1`,
      [callId, data.callSid ?? null, data.conversation_id ?? null],
    );
    await this.guard.logAttempt({
      accountId,
      phoneNumber: toE164,
      contactId: dto.contactId,
      voiceCallId: callId,
      outcome: 'placed:elevenlabs',
    });

    return {
      ok: true,
      callId,
      via: 'elevenlabs',
      conversationId: data.conversation_id,
      twilioCallSid: data.callSid,
    };
  }

  private async linkConversation(
    accountId: string,
    pn: OwnedPhoneNumber,
    toE164: string,
    callId: string,
  ): Promise<void> {
    try {
      const contactRows = await this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM contacts WHERE account_id = $1 AND phone_number = $2 LIMIT 1`,
        [accountId, toE164],
      );
      const contact = contactRows[0];
      if (contact && pn.inbox_id) {
        const convRows = await this.tx.manager.query<
          { get_or_create_open_conversation: string }[]
        >(
          `SELECT public.get_or_create_open_conversation($1, $2, $3) AS get_or_create_open_conversation`,
          [accountId, contact.id, pn.inbox_id],
        );
        const convId = convRows[0]?.get_or_create_open_conversation;
        if (convId) {
          await this.tx.manager.query(
            `UPDATE voice_calls SET conversation_id = $2 WHERE id = $1`,
            [callId, convId],
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `failed to link conversation for call=${callId}: ${String(err)}`,
      );
    }
  }

  private async buildDynamicVariables(
    accountId: string,
    personaName: string,
    toE164: string,
    dto: PlaceCallDto,
    callId: string,
    preLeadName: string | null,
  ): Promise<Record<string, string>> {
    const vars: Record<string, string> = {};
    try {
      const [settingsRows, contactRows] = await Promise.all([
        this.tx.manager.query<
          { company_name: string | null; support_phone: string | null }[]
        >(
          `SELECT company_name, support_phone FROM company_settings WHERE account_id = $1 LIMIT 1`,
          [accountId],
        ),
        this.tx.manager.query<{ id: string; name: string | null }[]>(
          `SELECT id, name FROM contacts WHERE account_id = $1 AND phone_number = $2 LIMIT 1`,
          [accountId, toE164],
        ),
      ]);
      const settings = settingsRows[0];
      const contact = contactRows[0];

      vars.company_name = settings?.company_name ?? 'sua empresa';
      vars.agent_name = personaName;
      vars.support_phone = settings?.support_phone ?? '';
      vars.call_purpose = dto.callPurpose ?? 'discovery';

      if (contact) {
        vars.lead_name = (contact.name ?? '').split(' ')[0] || 'olá';
      }

      if (dto.meetingId) {
        const meetingRows = await this.tx.manager.query<
          {
            id: string;
            starts_at: string;
            attendee_user_id: string | null;
            invitee_name: string | null;
          }[]
        >(
          `SELECT id, starts_at, attendee_user_id, invitee_name FROM scheduled_meetings
           WHERE id = $1 AND account_id = $2 LIMIT 1`,
          [dto.meetingId, accountId],
        );
        const meeting = meetingRows[0];
        if (meeting) {
          vars.meeting_id = String(meeting.id);
          vars.meeting_starts_at_iso = String(meeting.starts_at);
          vars.meeting_starts_at_human = new Intl.DateTimeFormat('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Sao_Paulo',
          }).format(new Date(meeting.starts_at));
          if (meeting.attendee_user_id) {
            const profRows = await this.tx.manager.query<
              {
                display_name: string | null;
                name: string | null;
                email: string;
              }[]
            >(
              `SELECT display_name, name, email FROM profiles WHERE id = $1 LIMIT 1`,
              [meeting.attendee_user_id],
            );
            const prof = profRows[0];
            vars.attendee_name =
              prof?.display_name ??
              prof?.name ??
              prof?.email ??
              'nosso especialista';
          }
          if (!preLeadName && meeting.invitee_name) {
            const existing = await this.tx.manager.query<
              { metadata: Record<string, unknown> }[]
            >(`SELECT metadata FROM voice_calls WHERE id = $1 LIMIT 1`, [
              callId,
            ]);
            const md = existing[0]?.metadata ?? {};
            await this.tx.manager.query(
              `UPDATE voice_calls SET metadata = $2::jsonb WHERE id = $1`,
              [
                callId,
                JSON.stringify({ ...md, lead_name: meeting.invitee_name }),
              ],
            );
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `failed to build dynamic_variables (continuing): ${String(err)}`,
      );
    }
    return vars;
  }

  private async callElevenLabs(
    creds: ElevenLabsCredentials,
    args: {
      agentId: string;
      elPhoneId: string;
      toE164: string;
      systemPrompt: string;
      firstMessage: string;
      voiceCloneId?: string;
      dynamicVariables: Record<string, string>;
    },
  ): Promise<{
    res: { ok: boolean; status: number };
    data: {
      success?: boolean;
      callSid?: string;
      conversation_id?: string;
      [k: string]: unknown;
    };
    timedOut: boolean;
  }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EL_TIMEOUT_MS);
    let timedOut = false;
    let httpRes: Response;
    try {
      httpRes = await this.elClient.request<Response>({
        method: 'POST',
        path: '/v1/convai/twilio/outbound-call',
        credentials: creds,
        raw: true,
        json: {
          agent_id: args.agentId,
          agent_phone_number_id: args.elPhoneId,
          to_number: args.toE164,
          conversation_initiation_client_data: {
            conversation_config_override: {
              asr: { keywords: ['português', 'Brasil', 'Nina'] },
              agent: {
                language: PT_BR_LANGUAGE,
                first_message: args.firstMessage,
                prompt: { prompt: args.systemPrompt },
              },
              tts: { voice_id: args.voiceCloneId },
            },
            dynamic_variables: args.dynamicVariables,
          },
        },
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        timedOut = true;
        httpRes = new Response('timeout', { status: 504 });
      } else {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
    const data = timedOut
      ? {}
      : ((await httpRes.json().catch(() => ({}))) as Record<string, unknown>);
    return { res: { ok: httpRes.ok, status: httpRes.status }, data, timedOut };
  }

  private async fallbackToTwilio(
    accountId: string,
    userId: string,
    dto: PlaceCallDto,
    pn: OwnedPhoneNumber,
    personaId: string,
    toE164: string,
    callId: string,
    elStatus: number,
    timedOut: boolean,
  ): Promise<PlaceCallResult> {
    this.logger.warn(
      `EL failed (${elStatus}, timeout=${timedOut}) — fallback to Twilio for call=${callId}`,
    );

    const existing = await this.tx.manager.query<
      { metadata: Record<string, unknown> }[]
    >(`SELECT metadata FROM voice_calls WHERE id = $1 LIMIT 1`, [callId]);
    const currentMetadata = existing[0]?.metadata ?? {};
    await this.tx.manager.query(
      `UPDATE voice_calls SET metadata = $2::jsonb WHERE id = $1`,
      [
        callId,
        JSON.stringify({
          ...currentMetadata,
          fallback_from: 'elevenlabs',
          el_status: elStatus,
          el_timeout: timedOut,
          source: 'elevenlabs',
          initiated_by: userId,
        }),
      ],
    );

    const fb = await this.twilioOutbound.placeCall(
      accountId,
      userId,
      { fromNumberId: pn.id, toNumber: toE164, personaId },
      callId,
    );

    if (!fb.ok) {
      return {
        ok: false,
        callId,
        via: 'twilio_fallback',
        reason: 'twilio_call_failed',
        message: fb.message,
      };
    }
    return {
      ok: true,
      callId,
      via: 'twilio_fallback',
      twilioCallSid: fb.twilioCallSid,
      status: fb.status,
    };
  }
}
