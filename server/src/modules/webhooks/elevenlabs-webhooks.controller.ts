import { Controller, Post, Req, Res, HttpCode, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';
import { CallFinalizeService } from '../voice/call-finalize.service';
import {
  CallPersonalizationService,
  type PersonalizationPayload,
} from '../voice/call-personalization.service';

interface ElEventPayload {
  type?: string;
  event_type?: string;
  call_id?: string;
  conversation_id?: string;
  data?: {
    conversation_id?: string;
    status?: string;
    transcript?: Array<{
      role: string;
      message: string;
      time_in_call_secs?: number;
    }>;
    metadata?: {
      start_time_unix_secs?: number;
      call_duration_secs?: number;
      cost?: number;
    };
    analysis?: {
      evaluation_criteria_results?: Record<string, unknown>;
      data_collection_results?: Record<string, unknown>;
      call_successful?: string;
      transcript_summary?: string;
    };
  };
}

const FINAL_EVENT_TYPES = new Set([
  'call_end',
  'post_call_transcription',
  'conversation_ended',
]);

/**
 * Ported from supabase/functions/elevenlabs-events — thin post-call webhook
 * trigger from ElevenLabs. Delegates all real work to CallFinalizeService
 * (in-process, unlike the original's HTTP loopback to voice-call-finalize).
 * Best-effort by design: signature mismatch and handler failures both still
 * return 200 — the finalize-pending cron retry is the fallback if this
 * webhook never arrives or fails, matching the original's own rationale.
 */
@Controller('webhooks/elevenlabs')
export class ElevenLabsWebhooksController {
  private readonly logger = new Logger(ElevenLabsWebhooksController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly callFinalize: CallFinalizeService,
    private readonly personalization: CallPersonalizationService,
  ) {}

  @Public()
  @Post('events')
  @HttpCode(200)
  async events(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';
    let payload: ElEventPayload;

    // Sem secret configurado, a assinatura não pode ser checada — melhor
    // recusar (fail closed, igual ao webhook da Evolution) do que aceitar
    // qualquer chamador sem autenticação nenhuma, que poderia forçar
    // reclassificação/finalização de qualquer voice_calls conhecendo (ou
    // adivinhando) call_id/conversation_id.
    if (!secret) {
      this.logger.error(
        'ELEVENLABS_WEBHOOK_SECRET não configurado — rejeitando webhook',
      );
      res.status(500).json({ ok: false, error: 'webhook not configured' });
      return;
    }

    const sigHeader =
      (req.headers['elevenlabs-signature'] as string) ??
      (req.headers['x-elevenlabs-signature'] as string) ??
      '';
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    if (!this.verifySignature(rawBody, sigHeader, secret)) {
      this.logger.warn('signature mismatch — ignoring');
      res.status(200).json({ ok: true, ignored: 'bad signature' });
      return;
    }
    try {
      payload = JSON.parse(rawBody) as ElEventPayload;
    } catch {
      res.status(400).json({ ok: false, error: 'invalid JSON' });
      return;
    }

    try {
      await this.handleEvent(payload);
    } catch (err) {
      this.logger.error(`handler failed: ${(err as Error).message}`);
    }

    res.status(200).json({ ok: true });
  }

  /**
   * Ported from supabase/functions/elevenlabs-personalization — called by EL
   * at the START of every call. Different auth scheme than /events (plain
   * shared-secret header, not HMAC) and different failure semantics: EL
   * needs *some* valid response to proceed, so a bad-JSON body still
   * returns 200 with an empty object rather than an error status.
   */
  @Public()
  @Post('personalization')
  @HttpCode(200)
  async personalizationWebhook(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expected = process.env.ELEVENLABS_WEBHOOK_SECRET ?? '';
    if (!expected) {
      this.logger.error(
        'ELEVENLABS_WEBHOOK_SECRET não configurado — rejeitando webhook',
      );
      res.status(500).send('webhook not configured');
      return;
    }
    const received = (req.headers['x-el-webhook-secret'] as string) ?? '';
    if (!this.safeEqualStrings(expected, received)) {
      res.status(403).send('Forbidden');
      return;
    }

    let payload: PersonalizationPayload;
    try {
      payload = req.body as PersonalizationPayload;
      if (!payload || typeof payload !== 'object')
        throw new Error('empty body');
    } catch {
      res.status(200).json({});
      return;
    }

    try {
      const result = await this.personalization.personalize(payload);
      res.status(200).json(result);
    } catch (err) {
      this.logger.error(`personalization failed: ${(err as Error).message}`);
      res.status(200).json({});
    }
  }

  private safeEqualStrings(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  private async handleEvent(payload: ElEventPayload): Promise<void> {
    const eventType = payload.type ?? payload.event_type ?? '';
    const callId =
      payload.call_id ??
      payload.conversation_id ??
      payload.data?.conversation_id;

    this.logger.log(`type=${eventType} callId=${callId}`);

    if (!FINAL_EVENT_TYPES.has(eventType)) return;
    if (!callId) {
      this.logger.warn('no callId in payload');
      return;
    }

    // Três estratégias de match, por ordem de especificidade:
    // 1. source_id = EL conversation_id (ligações outbound configuradas pelo nosso dispatcher)
    // 2. provider_call_sid = Twilio SID (caso o EL devolva o SID da Twilio como call_id)
    // 3. id::text = UUID interno passado via <Parameter name="call_id"> no TwiML inbound
    //    — sem este terceiro caso, chamadas inbound via EL nativo nunca chegam ao finalize
    //    pelo webhook (caem só no cron retry).
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM voice_calls
       WHERE source_id = $1 OR provider_call_sid = $1
          OR (id::text = $1)
       LIMIT 1`,
      [callId],
    );
    const call = rows[0];
    if (!call) {
      this.logger.warn(`no voice_call for ${callId} — cron will retry later`);
      return;
    }

    const result = await this.callFinalize.finalize(call.id);
    const body = result.body as {
      ok?: boolean;
      classify?: { classification?: { category?: string } };
      sentiment?: { sentiment?: { aggregate?: string } };
    };
    this.logger.log(
      `finalize call=${call.id} ok=${body.ok} category=${body.classify?.classification?.category ?? '—'} sentiment=${body.sentiment?.sentiment?.aggregate ?? '—'}`,
    );
  }

  private verifySignature(
    body: string,
    header: string,
    secret: string,
  ): boolean {
    const parts = header.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2) ?? '';
    const sigHex = parts.find((p) => p.startsWith('v0='))?.slice(3) ?? '';
    if (!timestamp || !sigHex) return false;

    const payload = `${timestamp}.${body}`;
    const computed = createHmac('sha256', secret).update(payload).digest('hex');

    const a = Buffer.from(computed, 'hex');
    let b: Buffer;
    try {
      b = Buffer.from(sigHex.toLowerCase(), 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
