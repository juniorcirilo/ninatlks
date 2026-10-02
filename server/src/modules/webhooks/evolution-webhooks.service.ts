import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboundMessageService } from './inbound-message.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const IGNORED_EVENTS = new Set<string>([
  'MESSAGES_UPDATE',
  'MESSAGES_DELETE',
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
  'buttonsResponseMessage',
  'listResponseMessage',
  'templateButtonReplyMessage',
  'interactiveResponseMessage',
]);

const MEDIA_KEYS = [
  ['imageMessage', 'image'],
  ['videoMessage', 'video'],
  ['audioMessage', 'audio'],
  ['documentMessage', 'document'],
  ['stickerMessage', 'sticker'],
] as const;

interface EvolutionMessageKey {
  fromMe?: boolean;
  remoteJid?: string;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  imageMessage?: MediaInfo;
  videoMessage?: MediaInfo;
  documentMessage?: MediaInfo;
  audioMessage?: MediaInfo;
  stickerMessage?: MediaInfo;
  buttonsResponseMessage?: {
    selectedButtonId?: string;
    selectedDisplayText?: string;
  };
  listResponseMessage?: {
    title?: string;
    singleSelectReply?: { selectedRowId?: string };
  };
  templateButtonReplyMessage?: {
    selectedId?: string;
    selectedDisplayText?: string;
  };
  interactiveResponseMessage?: {
    body?: { text?: string };
    nativeFlowResponseMessage?: { name?: string; paramsJson?: string };
  };
  /** Presente quando o webhook foi configurado com base64: true. */
  base64?: string;
}

interface MediaInfo {
  caption?: string;
  mimetype?: string;
  fileName?: string;
  fileLength?: number | string;
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
  /** PRESENCE_UPDATE */
  id?: string;
  presences?: Record<string, { lastKnownPresence?: string }>;
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
    private readonly storage: StorageService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async handle(payload: EvolutionPayload): Promise<{ ignored?: string }> {
    // Evolution v2 sends the event name dot-separated in the webhook body
    // (e.g. "messages.upsert"), even though its own config env vars use
    // underscores (WEBHOOK_EVENTS_MESSAGES_UPSERT). Normalize so both forms
    // match IGNORED_EVENTS/the MESSAGES_UPSERT check below — without this,
    // every real inbound message was silently dropped as "unknown event".
    const event = str(payload?.event).toUpperCase().replace(/\./g, '_');
    const data: EvolutionEventData = payload?.data ?? payload ?? {};

    if (event === 'PRESENCE_UPDATE') {
      await this.handlePresence(payload, data);
      return {};
    }

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
    const reply = this.interactiveReply(msg);
    const text: string =
      (typeof msg.conversation === 'string' && msg.conversation) ||
      str(msg.extendedTextMessage?.text) ||
      str(msg.imageMessage?.caption) ||
      str(msg.videoMessage?.caption) ||
      str(msg.documentMessage?.caption) ||
      (reply?.text ?? '');

    const media = MEDIA_KEYS.find(([k]) => !!msg[k]);
    const hasMedia = !!media;

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
        text: text.trim() || (hasMedia ? `[${media[1]}]` : ''),
        hasMedia,
        pushName: data.pushName ?? null,
        media: media
          ? { kind: media[1], info: msg[media[0]] ?? {}, base64: msg.base64 }
          : undefined,
        reply,
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
    media?: { kind: string; info: MediaInfo; base64?: string };
    reply?: { text: string; selectedId?: string } | null;
  }): Promise<void> {
    const { instanceName, remoteJid, messageId, text, hasMedia, pushName } =
      args;

    const byInstance = await this.dataSource.query<
      { id: string; account_id: string }[]
    >(
      `SELECT * FROM public.webhook_find_channel_by_config('whatsapp', 'instance_name', $1)`,
      [instanceName],
    );
    const channel = byInstance[0];

    // Sem fallback para "qualquer canal": webhook_find_any_channel ignorava
    // account_id e podia atribuir uma mensagem inbound à conta errada
    // sempre que instanceName não batesse com nenhum canal configurado
    // (payload malformado, campo não mapeado, ou o segredo compartilhado
    // globalmente sendo usado por outra instância) — injeção de dados
    // cross-tenant. Sem instância reconhecida, é melhor descartar a
    // mensagem do que adivinhar a conta.
    if (!channel) {
      this.logger.warn(`no whatsapp channel for instance ${instanceName}`);
      return;
    }

    const baseJid = remoteJid.replace(/:\d+@/, '@').split('@')[0];
    const identifier = `evolution:whatsapp:${baseJid}`;

    let contentAttributes: Record<string, unknown> | undefined;
    if (args.media) {
      contentAttributes = {
        kind: args.media.kind,
        mime: args.media.info.mimetype,
        filename: args.media.info.fileName,
        caption: args.media.info.caption || undefined,
      };
      if (args.media.base64) {
        try {
          const ext = (args.media.info.mimetype ?? '')
            .split('/')[1]
            ?.split(';')[0];
          const key = `${channel.account_id}/incoming/${messageId}${ext ? `.${ext}` : ''}`;
          await this.storage.uploadObject(
            this.storage.attachmentsBucket,
            key,
            Buffer.from(args.media.base64, 'base64'),
            args.media.info.mimetype,
          );
          contentAttributes.storage_path = `${this.storage.attachmentsBucket}/${key}`;
        } catch (err) {
          this.logger.warn(`media upload failed: ${(err as Error).message}`);
        }
      }
    } else if (args.reply) {
      contentAttributes = {
        kind: 'interactive_reply',
        selected_id: args.reply.selectedId,
      };
    }

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
      contentAttributes,
      externalSourceIds: { evolution_message_id: messageId },
    });
  }

  /** Texto legível de uma resposta a botão/lista. */
  private interactiveReply(
    msg: EvolutionMessageContent,
  ): { text: string; selectedId?: string } | null {
    const b = msg.buttonsResponseMessage;
    if (b)
      return {
        text: str(b.selectedDisplayText) || str(b.selectedButtonId),
        selectedId: b.selectedButtonId,
      };
    const l = msg.listResponseMessage;
    if (l)
      return {
        text: str(l.title),
        selectedId: l.singleSelectReply?.selectedRowId,
      };
    const t = msg.templateButtonReplyMessage;
    if (t)
      return { text: str(t.selectedDisplayText), selectedId: t.selectedId };
    const i = msg.interactiveResponseMessage;
    if (i) {
      let selectedId: string | undefined;
      try {
        const params = JSON.parse(
          i.nativeFlowResponseMessage?.paramsJson ?? '{}',
        ) as { id?: string };
        selectedId = params.id;
      } catch {
        /* paramsJson inválido */
      }
      return { text: str(i.body?.text), selectedId };
    }
    return null;
  }

  /** "digitando…" do contato → evento efêmero para a UI (sem banco). */
  private async handlePresence(
    payload: EvolutionPayload,
    data: EvolutionEventData,
  ): Promise<void> {
    const instanceName =
      payload.instance || data.instance || data.instanceName || '';
    const jid = str(data.id);
    if (!instanceName || !jid || jid.endsWith('@g.us')) return;
    const entry =
      data.presences?.[jid] ?? Object.values(data.presences ?? {})[0];
    const presence = str(entry?.lastKnownPresence);
    if (!presence) return;
    const rows = await this.dataSource.query<
      { id: string; account_id: string }[]
    >(
      `SELECT * FROM public.webhook_find_channel_by_config('whatsapp', 'instance_name', $1)`,
      [instanceName],
    );
    if (!rows[0]) return;
    this.gateway.emitPresence(rows[0].account_id, {
      jid: jid.replace(/:\d+@/, '@').split('@')[0],
      presence,
    });
  }
}
