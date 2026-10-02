import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboundMessageService } from './inbound-message.service';

const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'PARAR',
  'CANCELAR',
  'SAIR',
  'DESCADASTRAR',
]);
const OPT_IN_KEYWORDS = new Set(['START', 'UNSTOP', 'INICIAR', 'RETOMAR']);

function classifyOptKeyword(
  body: string | null | undefined,
): 'opt_out' | 'opt_in' | null {
  if (!body) return null;
  const first = body.trim().toUpperCase().split(/\s+/)[0] ?? '';
  if (OPT_OUT_KEYWORDS.has(first)) return 'opt_out';
  if (OPT_IN_KEYWORDS.has(first)) return 'opt_in';
  return null;
}

/** Ported from supabase/functions/twilio-sms-incoming/index.ts. */
@Injectable()
export class TwilioSmsService {
  private readonly logger = new Logger(TwilioSmsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inbound: InboundMessageService,
  ) {}

  async handleInbound(form: Record<string, string>): Promise<void> {
    const messageSid = form.MessageSid ?? '';
    const from = form.From ?? '';
    const to = form.To ?? '';
    const body = form.Body ?? '';
    const numMedia = parseInt(form.NumMedia ?? '0', 10);
    if (!messageSid || !from || !to) return;

    const channelRows = await this.dataSource.query<
      { id: string; account_id: string; config: Record<string, unknown> }[]
    >(
      `SELECT * FROM public.webhook_find_channel_by_config('sms', 'from_number', $1)`,
      [to],
    );
    const channel = channelRows[0];
    if (!channel) {
      this.logger.warn(`no channel for To=${to}`);
      return;
    }

    const optKind = classifyOptKeyword(body);
    if (optKind === 'opt_out') {
      await this.dataSource.query(
        `SELECT public.webhook_sms_opt_out($1, $2, $3)`,
        [channel.account_id, from, body.slice(0, 140)],
      );
    } else if (optKind === 'opt_in') {
      await this.dataSource.query(`SELECT public.webhook_sms_opt_in($1, $2)`, [
        channel.account_id,
        from,
      ]);
    }

    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const u = form[`MediaUrl${i}`];
      if (u) mediaUrls.push(u);
    }

    await this.inbound.ingest({
      accountId: channel.account_id,
      channelId: channel.id,
      channelType: 'sms',
      inboxName: 'SMS',
      identifier: `sms:${from}`,
      contactName: form.ProfileName || from,
      contactPhone: from,
      sourceId: messageSid,
      content: body || (mediaUrls.length > 0 ? '[mms]' : ''),
      hasMedia: mediaUrls.length > 0,
      mediaUrls,
      externalSourceIds: { twilio_message_sid: messageSid },
    });
  }
}
