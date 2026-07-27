import { Controller, Post, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import {
  getPublicUrl,
  isWebhookVerificationDisabled,
  validateTwilioSignature,
} from '../../common/webhook-security.util';
import { TwilioVoiceService } from './twilio-voice.service';
import { TwilioSmsService } from './twilio-sms.service';
import { CallTranscriptionService } from '../voice/call-transcription.service';

const BUSY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="pt-BR" voice="Polly.Camila">Desculpe, todos os atendentes estão ocupados.</Say><Hangup/></Response>`;
const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

/** Ported from twilio-incoming/twilio-sms-incoming/twilio-status edge functions. */
@Controller('webhooks/twilio')
export class TwilioWebhooksController {
  constructor(
    private readonly voice: TwilioVoiceService,
    private readonly sms: TwilioSmsService,
    private readonly transcription: CallTranscriptionService,
  ) {}

  private verify(req: Request): boolean {
    if (isWebhookVerificationDisabled()) return true;
    const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';
    const signature = (req.headers['x-twilio-signature'] as string) ?? null;
    const form = req.body as Record<string, string>;
    const publicUrl = getPublicUrl({
      protocol: req.protocol,
      headers: req.headers,
      originalUrl: req.originalUrl,
    });
    if (validateTwilioSignature({ url: publicUrl, form, signature, authToken }))
      return true;

    // Fallback: canonical PUBLIC_API_URL-based URL, in case the request
    // arrived through a proxy hop getPublicUrl() couldn't fully reconstruct.
    const base = (process.env.PUBLIC_API_URL ?? '').replace(/\/$/, '');
    const canonicalUrl = `${base}${req.originalUrl}`;
    return validateTwilioSignature({
      url: canonicalUrl,
      form,
      signature,
      authToken,
    });
  }

  @Public()
  @Post('incoming')
  @HttpCode(200)
  async incoming(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.verify(req)) {
      res.status(403).type('text/xml').send(BUSY_TWIML);
      return;
    }
    try {
      const twiml = await this.voice.handleIncoming(
        req.body as Record<string, string>,
      );
      res.type('text/xml').send(twiml);
    } catch {
      res.type('text/xml').send(BUSY_TWIML);
    }
  }

  @Public()
  @Post('sms-incoming')
  @HttpCode(200)
  async smsIncoming(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.verify(req)) {
      res.status(403).type('text/xml').send(TWIML_EMPTY);
      return;
    }
    try {
      await this.sms.handleInbound(req.body as Record<string, string>);
    } catch {
      // swallow, matching original: SMS ingestion errors never fail the webhook
    }
    res.type('text/xml').send(TWIML_EMPTY);
  }

  @Public()
  @Post('status')
  @HttpCode(200)
  async status(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.verify(req)) {
      res.status(403).send('Forbidden');
      return;
    }
    try {
      await this.voice.handleStatus(req.body as Record<string, string>);
      res.send('ok');
    } catch {
      res.status(500).send('error');
    }
  }

  /**
   * Ported from twilio-recording-callback — Twilio's RecordingStatusCallback,
   * configured statically on the phone number / Console (not TwiML-driven,
   * confirmed no callers set this programmatically in the original either).
   * Reconfiguring the Twilio Console URL to point here is a manual step,
   * same caveat as the ElevenLabs agent-tool URLs — not done by this code.
   */
  @Public()
  @Post('recording-status')
  @HttpCode(200)
  async recordingStatus(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.verify(req)) {
      res.status(403).send('Forbidden');
      return;
    }
    const form = req.body as Record<string, string>;
    const recordingSid = form.RecordingSid ?? '';
    const callSid = form.CallSid ?? '';
    const recordingStatus = form.RecordingStatus ?? '';
    const duration = parseInt(form.RecordingDuration ?? '0', 10);

    if (!recordingSid || !callSid) {
      res.status(400).send('missing sids');
      return;
    }
    if (recordingStatus !== 'completed') {
      res.send('ok');
      return;
    }

    try {
      await this.transcription.persistAndTranscribe({
        callSid,
        recordingSid,
        durationSec: duration || null,
      });
    } catch {
      res.status(500).send('error');
      return;
    }
    res.send('ok');
  }
}
