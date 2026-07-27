import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboundMessageService } from './inbound-message.service';

const IGNORED_EVENTS = new Set<string>([
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
  'PRESENCE_UPDATE',
  'CHATS_UPDATE',
  'CHATS_UPSERT',
  'CHATS_DELETE',
  'CONTACTS_UPDATE',
  'CONTACTS_UPSERT',
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
  'SEND_MESSAGE',
  'MESSAGES_SET',
  'TYPEBOT_START',
  'TYPEBOT_CHANGE_STATUS',
  'CALL',
  'LABELS_EDIT',
  'LABELS_ASSOCIATION',
]);

const ACCEPTED_MESSAGE_TYPES = new Set<string>([
  'conversation',
  'extendedTextMessage',
  'imageMessage',
  'audioMessage',
  'videoMessage',
  'documentMessage',
  'stickerMessage',
]);

interface EvolutionMessageKey {
  fromMe?: boolean;
  remoteJid?: string;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: { caption?: string };
  videoMessage?: { caption?: string };
  documentMessage?: { caption?: string };
  audioMessage?: unknown;
  stickerMessage?: unknown;
}

interface EvolutionEventData {
  key?: EvolutionMessageKey;
  fromMe?: boolean;
  messageType?: string;
  message?: EvolutionMessageContent;
  remoteJid?: string;
  instance?: string;
  instanceName?: string;
  keyId?: string;
  messageId?: string;
  pushName?: string;
}

export interface EvolutionPayload {
  event?: string;
  instance?: string;
  data?: EvolutionEventData;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Ported from supabase/functions/evolution-incoming/index.ts. Strict by
 * design — only real user-typed inbound text/media messages are processed;
 * everything else (receipts, echoes of our own sends, group messages) is
 * dropped without touching the database.
 */
@Injectable()
export class EvolutionWebhooksService {
  private readonly logger = new Logger(EvolutionWebhooksService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly inbound: InboundMessageService,
  ) {}

  async handle(payload: EvolutionPayload): Promise<{ ignored?: string }> {
    const event = str(payload?.event).toUpperCase();
    const data: EvolutionEventData = payload?.data ?? payload ?? {};

    if (event && event !== 'MESSAGES_UPSERT') {
      if (IGNORED_EVENTS.has(event)) return { ignored: event };
      this.logger.log(`dropping unknown event=${event}`);
      return { ignored: event };
    }

    const key = data.key ?? {};
    const fromMe = key.fromMe === true || data.fromMe === true;
    if (fromMe) return { ignored: 'fromMe' };

    const messageType = str(data.messageType);
    if (messageType && !ACCEPTED_MESSAGE_TYPES.has(messageType)) {
      return { ignored: `messageType:${messageType}` };
    }

    const msg = data.message ?? {};
    const text: string =
      (typeof msg.conversation === 'string' && msg.conversation) ||
      str(msg.extendedTextMessage?.text) ||
      str(msg.imageMessage?.caption) ||
      str(msg.videoMessage?.caption) ||
      str(msg.documentMessage?.caption) ||
      '';

    const hasMedia = !!(
      msg.imageMessage ||
      msg.audioMessage ||
      msg.videoMessage ||
      msg.documentMessage ||
      msg.stickerMessage
    );

    if (!text.trim() && !hasMedia) {
      this.logger.log(
        `dropping empty payload msgType=${messageType} keys=${Object.keys(msg).join(',')}`,
      );
      return { ignored: 'empty' };
    }

    const remoteJid = key.remoteJid || data.remoteJid || '';
    if (!remoteJid) return { ignored: 'no_remoteJid' };
    if (remoteJid.endsWith('@g.us')) return { ignored: 'group' };

    const instanceName =
      payload.instance || data.instance || data.instanceName || '';
    const messageId = key.id || data.keyId || data.messageId || '';
    if (!messageId) return { ignored: 'no_messageId' };

    try {
      await this.ingest({
        instanceName,
        remoteJid,
        messageId,
        text: text.trim() || (hasMedia ? '[mídia]' : ''),
        hasMedia,
        pushName: data.pushName ?? null,
      });
    } catch (err) {
      this.logger.error('handle failed', err as Error);
    }
    return {};
  }

  private async ingest(args: {
    instanceName: string;
    remoteJid: string;
    messageId: string;
    text: string;
    hasMedia: boolean;
    pushName: string | null;
  }): Promise<void> {
    const { instanceName, remoteJid, messageId, text, hasMedia, pushName } =
      args;

    const byInstance = await this.dataSource.query<
      { id: string; account_id: string }[]
    >(
      `SELECT * FROM public.webhook_find_channel_by_config('whatsapp', 'instance_name', $1)`,
      [instanceName],
    );
    let channel = byInstance[0];

    if (!channel) {
      const anyChannel = await this.dataSource.query<
        { id: string; account_id: string }[]
      >(`SELECT * FROM public.webhook_find_any_channel('whatsapp')`);
      channel = anyChannel[0];
    }
    if (!channel) {
      this.logger.warn(`no whatsapp channel for instance ${instanceName}`);
      return;
    }

    const baseJid = remoteJid.replace(/:\d+@/, '@').split('@')[0];
    const identifier = `evolution:whatsapp:${baseJid}`;

    await this.inbound.ingest({
      accountId: channel.account_id,
      channelId: channel.id,
      channelType: 'whatsapp',
      inboxName: 'WhatsApp',
      identifier,
      contactName: pushName ?? 'WhatsApp (sem número)',
      sourceId: messageId,
      content: text,
      hasMedia,
      externalSourceIds: { evolution_message_id: messageId },
    });
  }
}
