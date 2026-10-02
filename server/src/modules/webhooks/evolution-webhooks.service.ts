import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboundMessageService } from './inbound-message.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { EvolutionClientService } from '../evolution/evolution-client.service';
import {
  contactIdentifierFor,
  isLidJid,
  isPnJid,
  normalizeJid,
  phoneOf,
} from '../evolution/jid.util';

const IGNORED_EVENTS = new Set<string>([
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

// MESSAGES_UPDATE.status do Evolution → delivery_status do app.
const STATUS_MAP: Record<string, string> = {
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'played',
  ERROR: 'error',
};

interface ChannelCfg {
  evolution_url?: string;
  evolution_api_key?: string;
  evolution_instance_name?: string;
}

interface EvolutionMessageKey {
  /** Telefone real quando remoteJid é um LID. */
  remoteJidAlt?: string;
  participantAlt?: string;
  fromMe?: boolean;
  remoteJid?: string;
  id?: string;
}

interface EvolutionMessageContent {
  conversation?: string;
  extendedTextMessage?: {
    text?: string;
    contextInfo?: {
      stanzaId?: string;
      participant?: string;
      quotedMessage?: {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
      };
    };
  };
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
  data?: EvolutionEventData | EvolutionEventData[];
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
    private readonly evolutionClient: EvolutionClientService,
  ) {}

  /** lid → telefone aprendido (processo); evita reconsultar o Evolution. */
  private readonly lidCache = new Map<string, string>();
  /** contato → última checagem da foto de perfil. */
  private readonly avatarChecked = new Map<string, number>();

  async handle(payload: EvolutionPayload): Promise<{ ignored?: string }> {
    // Evolution v2 sends the event name dot-separated in the webhook body
    // (e.g. "messages.upsert"), even though its own config env vars use
    // underscores (WEBHOOK_EVENTS_MESSAGES_UPSERT). Normalize so both forms
    // match IGNORED_EVENTS/the MESSAGES_UPSERT check below — without this,
    // every real inbound message was silently dropped as "unknown event".
    const event = str(payload?.event).toUpperCase().replace(/\./g, '_');
    const rawData = payload?.data ?? payload ?? {};
    const data: EvolutionEventData = Array.isArray(rawData)
      ? (rawData[0] ?? {})
      : rawData;

    if (event === 'PRESENCE_UPDATE') {
      await this.handlePresence(payload, data);
      return {};
    }

    if (event === 'MESSAGES_UPDATE') {
      await this.handleStatus(payload, data);
      return {};
    }

    if (event && event !== 'MESSAGES_UPSERT') {
      if (IGNORED_EVENTS.has(event)) return { ignored: event };
      this.logger.log(`dropping unknown event=${event}`);
      return { ignored: event };
    }

    const key = data.key ?? {};
    const fromMe = key.fromMe === true || data.fromMe === true;

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
        fromMe,
        quote: this.quoteOf(msg, remoteJid),
        remoteJidAlt: key.remoteJidAlt ?? key.participantAlt ?? '',
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
    fromMe?: boolean;
    quote?: {
      message_id: string;
      content: string | null;
      from_me: boolean;
    } | null;
    remoteJidAlt?: string;
    media?: { kind: string; info: MediaInfo; base64?: string };
    reply?: { text: string; selectedId?: string } | null;
  }): Promise<void> {
    const { instanceName, remoteJid, messageId, text, hasMedia, pushName } =
      args;

    const byInstance = await this.dataSource.query<
      { id: string; account_id: string; config: ChannelCfg }[]
    >(
      `SELECT * FROM public.webhook_find_channel_by_config('whatsapp', 'evolution_instance_name', $1)`,
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

    // LID → telefone (remoteJidAlt do payload, cache ou consulta ao Evolution).
    const jid = await this.resolveJid(
      channel.config,
      remoteJid,
      args.remoteJidAlt,
    );
    const identifier = contactIdentifierFor(jid);
    const contactPhone = phoneOf(jid);
    void this.refreshAvatar(
      channel.account_id,
      channel.config,
      identifier,
      jid,
    );

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
    if (args.quote) {
      contentAttributes = {
        kind: 'text',
        ...contentAttributes,
        reply_to: args.quote,
      };
    }

    // Enviada pelo celular do atendente: entra como saída na conversa existente.
    if (args.fromMe) {
      await this.dataSource.query(
        `SELECT public.webhook_ingest_outbound_message($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          instanceName,
          identifier,
          messageId,
          text,
          hasMedia ? 1 : 0,
          JSON.stringify(contentAttributes ?? { kind: 'text' }),
        ],
      );
      return;
    }

    const result = await this.inbound.ingest({
      accountId: channel.account_id,
      channelId: channel.id,
      channelType: 'whatsapp',
      inboxName: 'WhatsApp',
      identifier,
      contactPhone,
      contactName: pushName ?? 'WhatsApp (sem número)',
      sourceId: messageId,
      content: text,
      hasMedia,
      contentAttributes,
      externalSourceIds: { evolution_message_id: messageId },
    });
    void result;
  }

  /** Mensagem citada quando o contato usa "responder". */
  private quoteOf(
    msg: EvolutionMessageContent,
    remoteJid: string,
  ): { message_id: string; content: string | null; from_me: boolean } | null {
    const ctx = msg.extendedTextMessage?.contextInfo;
    if (!ctx?.stanzaId) return null;
    const q = ctx.quotedMessage;
    const content =
      str(q?.conversation) ||
      str(q?.extendedTextMessage?.text) ||
      str(q?.imageMessage?.caption) ||
      null;
    // Autor da citação diferente do contato → foi uma mensagem nossa.
    const author = (ctx.participant ?? '').replace(/\D/g, '');
    const contact = remoteJid.replace(/\D/g, '');
    const fromMe =
      !!author && !!contact && author.slice(-8) !== contact.slice(-8);
    return {
      message_id: ctx.stanzaId,
      content: content ? content.slice(0, 200) : null,
      from_me: fromMe,
    };
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
      `SELECT * FROM public.webhook_find_channel_by_config('whatsapp', 'evolution_instance_name', $1)`,
      [instanceName],
    );
    if (!rows[0]) return;
    this.gateway.emitPresence(rows[0].account_id, {
      jid: jid.replace(/:\d+@/, '@').split('@')[0],
      presence,
    });
  }

  /** Tiques: enviada → entregue → lida (MESSAGES_UPDATE). */
  private async handleStatus(
    payload: EvolutionPayload,
    data: EvolutionEventData,
  ): Promise<void> {
    const instanceName =
      payload.instance || data.instance || data.instanceName || '';
    const items = (Array.isArray(payload.data) ? payload.data : [data]) as (
      EvolutionEventData | undefined
    )[];
    for (const item of items) {
      const id = str(item?.keyId) || str(item?.key?.id) || str(item?.messageId);
      const raw = str((item as { status?: unknown } | undefined)?.status);
      const status = STATUS_MAP[raw.toUpperCase()] ?? null;
      if (!instanceName || !id || !status) continue;
      await this.dataSource
        .query(`SELECT public.webhook_update_message_status($1,$2,$3)`, [
          instanceName,
          id,
          status,
        ])
        .catch((err: Error) =>
          this.logger.warn(`status update failed: ${err.message}`),
        );
    }
  }

  /**
   * Resolve LID → JID de telefone. Fontes, em ordem: remoteJidAlt do próprio
   * payload, cache do processo e, por último, o chat no Evolution (que guarda
   * o remoteJidAlt da última mensagem). Sem resolução devolve o LID.
   */
  private async resolveJid(
    cfg: ChannelCfg,
    remoteJid: string,
    alt?: string,
  ): Promise<string> {
    const jid = normalizeJid(remoteJid);
    if (!isLidJid(jid)) return jid;

    if (alt && isPnJid(alt)) {
      this.lidCache.set(jid, normalizeJid(alt));
      return normalizeJid(alt);
    }
    const cached = this.lidCache.get(jid);
    if (cached) return cached;

    if (
      cfg?.evolution_url &&
      cfg.evolution_api_key &&
      cfg.evolution_instance_name
    ) {
      try {
        const chats = await this.evolutionClient.findChats(
          {
            url: cfg.evolution_url,
            apiKey: cfg.evolution_api_key,
            instanceName: cfg.evolution_instance_name,
          },
          jid,
        );
        const found = chats
          .map((c) => c.lastMessage?.key?.remoteJidAlt)
          .find((v): v is string => !!v && isPnJid(v));
        if (found) {
          this.lidCache.set(jid, normalizeJid(found));
          return normalizeJid(found);
        }
      } catch (err) {
        this.logger.warn(`lid resolve failed: ${(err as Error).message}`);
      }
    }
    return jid;
  }

  /** Foto de perfil do contato: no máx. 1 consulta/dia por contato. */
  private async refreshAvatar(
    accountId: string,
    cfg: ChannelCfg,
    identifier: string,
    jid: string,
  ): Promise<void> {
    const key = `${accountId}:${identifier}`;
    const last = this.avatarChecked.get(key) ?? 0;
    if (Date.now() - last < 24 * 60 * 60 * 1000) return;
    if (
      !cfg?.evolution_url ||
      !cfg.evolution_api_key ||
      !cfg.evolution_instance_name
    )
      return;
    this.avatarChecked.set(key, Date.now());
    try {
      const url = await this.evolutionClient.fetchProfilePictureUrl({
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number: jid,
      });
      if (!url) return;
      // O contato só existe depois do ingest; tenta de novo após um instante.
      for (const wait of [1500, 5000]) {
        await new Promise((r) => setTimeout(r, wait));
        const rows = await this.dataSource.query<{ ok: boolean }[]>(
          `SELECT public.webhook_set_contact_avatar($1,$2,$3) AS ok`,
          [accountId, identifier, url],
        );
        if (rows[0]?.ok) return;
      }
    } catch (err) {
      this.avatarChecked.delete(key);
      this.logger.warn(`avatar refresh failed: ${(err as Error).message}`);
    }
  }
}
