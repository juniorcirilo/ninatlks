import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PersonaAutoReplyService } from '../messages/persona-auto-reply.service';

/**
 * Shared contact/inbox/conversation/message upsert used by both the Twilio
 * SMS and Evolution (WhatsApp) inbound webhooks. Ported from the nearly
 * identical `handleSms`/`handleMessage` helpers in
 * supabase/functions/twilio-sms-incoming and supabase/functions/evolution-incoming.
 *
 * Auto-reply is invoked directly in-process right after a successful insert
 * (PersonaAutoReplyService, fire-and-forget — never throws). This replaces
 * the old `tg_trigger_auto_reply` Postgres trigger, which called out via
 * pg_net to a Supabase Edge Function that no longer exists in this backend
 * (see 20260807120000-DropLegacyAutoReplyTrigger.ts).
 *
 * Goes through `webhook_ingest_inbound_message`, a SECURITY DEFINER
 * function (migrations/20260720160000-InboundMessagingBypass.ts, extended in
 * 20260807110000-PersonaAutoReplyBypass.ts to return the conversation/message
 * ids) — an inbound webhook has no session/tenant context (it's an external
 * system authenticated by signature, not a user), and every table this
 * touches is RLS-enabled+forced keyed on auth.uid(). Without the bypass this
 * silently dropped every inbound message under real RLS.
 */
@Injectable()
export class InboundMessageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly autoReply: PersonaAutoReplyService,
  ) {}

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
    /** Sobrescreve content_attributes (anexo salvo, resposta interativa…). */
    contentAttributes?: Record<string, unknown>;
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
      contentAttributes: attributesOverride,
      externalSourceIds,
    } = args;

    const contentType = hasMedia ? 1 : 0;
    const contentAttributes =
      attributesOverride ??
      (hasMedia
        ? {
            kind: 'image',
            media_urls: mediaUrls?.length ? mediaUrls : undefined,
          }
        : { kind: 'text' });

    const [row] = await this.dataSource.query<
      {
        webhook_ingest_inbound_message: {
          inserted: boolean;
          conversation_id: string | null;
          inbox_id: string | null;
          message_id: string | null;
        };
      }[]
    >(
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

    const result = row?.webhook_ingest_inbound_message;
    if (result?.inserted && result.conversation_id && result.message_id) {
      void this.autoReply.maybeReply({
        conversationId: result.conversation_id,
        triggeringMessageId: result.message_id,
      });
    }

    return { inserted: result?.inserted ?? false };
  }
}
