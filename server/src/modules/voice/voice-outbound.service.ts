import { Injectable, Logger, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  TwilioClientService,
  TwilioError,
} from '../twilio/twilio-client.service';
import {
  TwilioConfigService,
  TwilioConfigError,
} from '../twilio/twilio-config.service';
import { VoiceGuardService } from './voice-guard.service';
import { PlaceCallDto } from './dto/place-call.dto';

export interface PlaceCallResult {
  ok: boolean;
  callId: string;
  via: 'twilio' | 'elevenlabs' | 'twilio_fallback';
  status?: string;
  reason?: string;
  message?: string;
  twilioCallSid?: string;
  conversationId?: string;
}

interface OwnedPhoneNumber {
  id: string;
  account_id: string;
  e164: string;
  outbound_enabled: boolean;
  enabled: boolean;
}

/**
 * Ported from supabase/functions/voice-outbound/index.ts — the Twilio-direct
 * outbound dialing path (guard → create voice_calls row → POST /Calls.json).
 * ElevenLabs-native outbound (elevenlabs-outbound-call) is a separate,
 * not-yet-ported path; phone_numbers.elevenlabs_phone_number_id routing
 * between the two lives in the frontend placeCall() wrapper, same as before.
 */
@Injectable({ scope: Scope.REQUEST })
export class VoiceOutboundService {
  private readonly logger = new Logger(VoiceOutboundService.name);

  constructor(
    private readonly tx: TenantTxHost,
    private readonly guard: VoiceGuardService,
    private readonly twilioConfig: TwilioConfigService,
    private readonly twilioClient: TwilioClientService,
  ) {}

  async placeCall(
    accountId: string,
    userId: string,
    dto: PlaceCallDto,
    reuseCallId?: string,
  ): Promise<PlaceCallResult> {
    const phoneRows = await this.tx.manager.query<OwnedPhoneNumber[]>(
      `SELECT id, account_id, e164, outbound_enabled, enabled FROM phone_numbers
        WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [dto.fromNumberId, accountId],
    );
    const phoneNumber = phoneRows[0];
    if (!phoneNumber) {
      return {
        ok: false,
        callId: '',
        via: 'twilio',
        reason: 'not_found',
        message: 'Número não encontrado',
      };
    }
    if (!phoneNumber.enabled || !phoneNumber.outbound_enabled) {
      return {
        ok: false,
        callId: '',
        via: 'twilio',
        reason: 'outbound_disabled',
        message: 'Outbound não habilitado para este número',
      };
    }

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

    let callId: string;
    if (reuseCallId) {
      // Fallback path from VoiceElOutboundService: the row already exists,
      // created by the EL attempt — reuse it instead of duplicating.
      const existingRows = await this.tx.manager.query<
        { id: string; account_id: string }[]
      >(`SELECT id, account_id FROM voice_calls WHERE id = $1 LIMIT 1`, [
        reuseCallId,
      ]);
      const existing = existingRows[0];
      if (!existing || existing.account_id !== accountId) {
        return {
          ok: false,
          callId: '',
          via: 'twilio',
          reason: 'invalid_reuse_call_id',
          message: 'X-Reuse-Voice-Call-Id inválido',
        };
      }
      await this.tx.manager.query(
        `UPDATE voice_calls SET status = 'queued', to_number = $2, provider = 'twilio' WHERE id = $1`,
        [reuseCallId, toE164],
      );
      callId = reuseCallId;
    } else {
      const callRows = await this.tx.manager.query<{ id: string }[]>(
        `INSERT INTO voice_calls
           (account_id, phone_number_id, persona_id, direction, status, provider,
            from_number, to_number, started_at, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, 'outbound', 'queued', 'twilio', $4, $5, now(), $6::jsonb, now(), now())
         RETURNING id`,
        [
          accountId,
          phoneNumber.id,
          dto.personaId ?? null,
          phoneNumber.e164,
          toE164,
          JSON.stringify({
            initiated_by: userId,
            contact_id: dto.contactId ?? null,
            notes: dto.notes ?? null,
            meeting_id: dto.meetingId ?? null,
            call_purpose: dto.callPurpose ?? 'discovery',
          }),
        ],
      );
      callId = callRows[0].id;
    }

    let creds;
    try {
      creds = await this.twilioConfig.loadAccountCreds(accountId);
    } catch (err) {
      const reason =
        err instanceof TwilioConfigError
          ? 'twilio_not_configured'
          : 'rpc_error';
      await this.tx.manager.query(
        `UPDATE voice_calls SET status = 'failed', metadata = metadata || $2::jsonb WHERE id = $1`,
        [callId, JSON.stringify({ reason })],
      );
      await this.guard.logAttempt({
        accountId,
        phoneNumber: toE164,
        contactId: dto.contactId,
        voiceCallId: callId,
        outcome: `failed:${reason}`,
      });
      return {
        ok: false,
        callId,
        via: 'twilio',
        status: 'failed',
        reason,
        message:
          err instanceof Error
            ? err.message
            : 'Configure Twilio Account SID e Auth Token para ativar discagem.',
      };
    }

    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    try {
      const twData = await this.twilioClient.request<{ sid: string }>({
        method: 'POST',
        path: `/2010-04-01/Accounts/${creds.accountSid}/Calls.json`,
        credentials: creds,
        form: {
          To: toE164,
          From: phoneNumber.e164,
          Url: `${base}/webhooks/twilio/incoming`,
          Timeout: dto.timeoutSeconds ?? 30,
          StatusCallback: `${base}/webhooks/twilio/status`,
          StatusCallbackEvent: 'initiated ringing answered completed',
        },
      });

      await this.tx.manager.query(
        `UPDATE voice_calls SET provider_call_sid = $2, status = 'queued' WHERE id = $1`,
        [callId, twData.sid],
      );
      await this.guard.logAttempt({
        accountId,
        phoneNumber: toE164,
        contactId: dto.contactId,
        voiceCallId: callId,
        outcome: 'placed',
      });
      return {
        ok: true,
        callId,
        via: 'twilio',
        status: 'queued',
        twilioCallSid: twData.sid,
      };
    } catch (err) {
      const twilioErr = err instanceof TwilioError ? err : null;
      const twilioCode = twilioErr?.code ?? null;
      const reason =
        twilioCode === 21219
          ? 'twilio_trial_unverified_number'
          : 'twilio_call_failed';
      const userMessage =
        twilioCode === 21219
          ? 'Número de destino não verificado. Contas Trial da Twilio só podem ligar pra números verificados.'
          : (twilioErr?.message ?? 'Twilio recusou a ligação.');

      await this.tx.manager.query(
        `UPDATE voice_calls SET status = 'failed', metadata = metadata || $2::jsonb WHERE id = $1`,
        [callId, JSON.stringify({ error: twilioErr?.details ?? String(err) })],
      );
      await this.guard.logAttempt({
        accountId,
        phoneNumber: toE164,
        contactId: dto.contactId,
        voiceCallId: callId,
        outcome: `failed:${reason}`,
      });
      this.logger.warn(`Twilio call failed callId=${callId} reason=${reason}`);
      return {
        ok: false,
        callId,
        via: 'twilio',
        status: 'failed',
        reason,
        message: userMessage,
      };
    }
  }
}
