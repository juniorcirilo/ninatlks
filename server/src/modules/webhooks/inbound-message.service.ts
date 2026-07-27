import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Shared contact/inbox/conversation/message upsert used by both the Twilio
 * SMS and Evolution (WhatsApp) inbound webhooks. Ported from the nearly
 * identical `handleSms`/`handleMessage` helpers in
 * supabase/functions/twilio-sms-incoming and supabase/functions/evolution-incoming.
 *
 * Auto-reply is NOT invoked here: the ported `tg_trigger_auto_reply` trigger
 * (Migration20260423191559 and siblings) already fires on every `messages`
 * INSERT via pg_net, so an explicit invoke here would double-fire it.
 *
 * Goes through `webhook_ingest_inbound_message`, a SECURITY DEFINER
 * function (migrations/20260720160000-InboundMessagingBypass.ts) — an
 * inbound webhook has no session/tenant context (it's an external system
 * authenticated by signature, not a user), and every table this touches is
 * RLS-enabled+forced keyed on auth.uid(). Without the bypass this silently
 * dropped every inbound message under real RLS.
 */
@Injectable()
export class InboundMessageService {
  constructor(private readonly dataSource: DataSource) {}

  async ingest(args: {
    accountId: string;
    channelId: string;
    channelType: 'sms' | 'whatsapp';
    inboxName: string;
    identifier: string;
    contactName: string;
    contactPhone?: string | null;
    sourceId: string;
    content: string;
    hasMedia: boolean;
    mediaUrls?: string[];
    externalSourceIds: Record<string, unknown>;
  }): Promise<{ inserted: boolean }> {
    const {
      accountId,
      channelId,
      channelType,
      inboxName,
      identifier,
      contactName,
      contactPhone,
      sourceId,
      content,
      hasMedia,
      mediaUrls,
      externalSourceIds,
    } = args;

    const contentType = hasMedia ? 1 : 0;
    const contentAttributes = hasMedia
      ? {
          kind: 'image',
          media_urls: mediaUrls?.length ? mediaUrls : undefined,
        }
      : { kind: 'text' };

    const [row] = await this.dataSource.query<{ webhook_ingest_inbound_message: boolean }[]>(
      `SELECT public.webhook_ingest_inbound_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [
        accountId,
        channelId,
        channelType,
        inboxName,
        identifier,
        contactName,
        contactPhone ?? null,
        sourceId,
        content,
        contentType,
        JSON.stringify(contentAttributes),
        JSON.stringify(externalSourceIds),
      ],
    );

    return { inserted: row?.webhook_ingest_inbound_message ?? false };
  }
}
