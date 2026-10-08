/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument --
   as tipagens públicas do @itsliaaa/baileys são `any` na maior parte da API de socket. */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InboundMessageService } from './inbound-message.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { SpeechService } from '../speech/speech.service';
import { WaSendService } from '../whatsapp/wa-send.service';
import type { Baileys, WAMessage, WASocket } from '../whatsapp/baileys';
import {
  SessionManagerService,
  type WaSession,
} from '../whatsapp/session-manager.service';
import {
  contactIdentifierFor,
  digitsOf,
  isGroupJid,
  isLidJid,
  isPnJid,
  normalizeJid,
  phoneOf,
} from '../whatsapp/jid.util';

const ACCEPTED_TYPES = new Set<string>([
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

// proto.WebMessageInfo.Status → delivery_status do app.
const STATUS_MAP: Record<number, string> = {
  0: 'error',
  2: 'sent',
  3: 'delivered',
  4: 'read',
  5: 'played',
};

/** proto.WebMessageInfo.StubType.REVOKE */
const REVOKE_STUB_TYPE = 1;

interface MessageUpdate {
  key: { id?: string | null; fromMe?: boolean | null };
  update: {
    status?: number | null;
    messageStubType?: number | null;
    message?: { editedMessage?: { message?: unknown } | null } | null;
  };
}

interface MediaInfo {
  caption?: string | null;
  mimetype?: string | null;
  fileName?: string | null;
}

interface WaContent {
  conversation?: string | null;
  extendedTextMessage?: {
    text?: string | null;
    contextInfo?: {
      stanzaId?: string | null;
      participant?: string | null;
      quotedMessage?: {
        conversation?: string | null;
        extendedTextMessage?: { text?: string | null } | null;
        imageMessage?: { caption?: string | null } | null;
        videoMessage?: { caption?: string | null } | null;
        documentMessage?: { caption?: string | null } | null;
      } | null;
    } | null;
  } | null;
  imageMessage?: MediaInfo | null;
  videoMessage?: MediaInfo | null;
  documentMessage?: MediaInfo | null;
  audioMessage?: MediaInfo | null;
  stickerMessage?: MediaInfo | null;
  buttonsResponseMessage?: {
    selectedButtonId?: string | null;
    selectedDisplayText?: string | null;
  } | null;
  listResponseMessage?: {
    title?: string | null;
    singleSelectReply?: { selectedRowId?: string | null } | null;
  } | null;
  templateButtonReplyMessage?: {
    selectedId?: string | null;
    selectedDisplayText?: string | null;
  } | null;
  interactiveResponseMessage?: {
    body?: { text?: string | null } | null;
    nativeFlowResponseMessage?: { paramsJson?: string | null } | null;
  } | null;
}

interface SecretEdit {
  secretEncType?: number | null;
  encPayload?: Uint8Array | null;
  encIv?: Uint8Array | null;
  targetMessageKey?: { id?: string | null } | null;
}

interface Reply {
  text: string;
  selectedId?: string;
}

interface Quote {
  message_id: string;
  content: string | null;
  from_me: boolean;
  media_kind?: string;
  author_name?: string;
}

/**
 * Liga os eventos do socket Baileys ao pipeline de mensagens do app
 * (mesmo caminho que o webhook do Evolution usava: InboundMessageService +
 * funções SQL de ingestão), agora em processo.
 */
@Injectable()
export class WaEventsService implements OnModuleInit {
  private readonly logger = new Logger(WaEventsService.name);
  /** contato → última checagem da foto de perfil (1x/dia). */
  private readonly avatarChecked = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly inbound: InboundMessageService,
    private readonly storage: StorageService,
    private readonly gateway: RealtimeGateway,
    private readonly sessions: SessionManagerService,
    private readonly waSend: WaSendService,
    private readonly speech: SpeechService,
  ) {}

  onModuleInit(): void {
    this.sessions.addAttachHandler((s, sock, B) => this.attach(s, sock, B));
  }

  attach(s: WaSession, sock: WASocket, B: Baileys): void {
    sock.ev.on(
      'messages.upsert',
      (u: { messages: WAMessage[]; type: string }) => {
        // "append" é histórico/sincronização: não vira mensagem nova no chat.
        if (u.type !== 'notify') return;
        for (const m of u.messages) {
          void this.handleMessage(s, sock, B, m).catch((err: Error) =>
            this.logger.error(`msg ${m.key?.id}: ${err.message}`),
          );
        }
      },
    );

    sock.ev.on('messages.update', (updates: MessageUpdate[]) => {
      for (const u of updates) {
        if (!u.key.id) continue;
        // Edição / exclusão (do contato, do celular ou do próprio app).
        const edited = u.update.message?.editedMessage?.message;
        if (edited) {
          const text = this.textOf(edited);
          if (text)
            this.dataSource
              .query(`SELECT public.webhook_apply_message_edit($1,$2,$3)`, [
                s.channelId,
                u.key.id,
                text,
              ])
              .catch((err: Error) =>
                this.logger.warn(`edit ${u.key.id}: ${err.message}`),
              );
          continue;
        }
        if (u.update.messageStubType === REVOKE_STUB_TYPE) {
          this.dataSource
            .query(`SELECT public.webhook_apply_message_revoke($1,$2)`, [
              s.channelId,
              u.key.id,
            ])
            .catch((err: Error) =>
              this.logger.warn(`revoke ${u.key.id}: ${err.message}`),
            );
          continue;
        }
        if (!u.key.fromMe || u.update.status == null) continue;
        const status = STATUS_MAP[u.update.status];
        if (!status) continue;
        this.dataSource
          .query(`SELECT public.webhook_update_message_status($1,$2,$3)`, [
            s.channelId,
            u.key.id,
            status,
          ])
          .catch((err: Error) =>
            this.logger.warn(`status ${u.key.id}: ${err.message}`),
          );
      }
    });

    sock.ev.on(
      'presence.update',
      (u: {
        id: string;
        presences: Record<
          string,
          { lastKnownPresence?: string; lastSeen?: number }
        >;
      }) => {
        if (isGroupJid(u.id)) return;
        const p = Object.values(u.presences ?? {})[0];
        if (!p?.lastKnownPresence) return;
        this.gateway.emitPresence(s.accountId, {
          jid: digitsOf(s.store.resolve(u.id)),
          chatJid: s.store.resolve(u.id),
          presence: p.lastKnownPresence,
          lastSeen: p.lastSeen,
        });
      },
    );

    sock.ev.on(
      'contacts.upsert',
      (
        list: {
          id: string;
          lid?: string;
          phoneNumber?: string;
          name?: string;
          notify?: string;
          imgUrl?: string | null;
        }[],
      ) => this.learnContacts(s, list),
    );
    sock.ev.on(
      'contacts.update',
      (
        list: {
          id?: string;
          lid?: string;
          phoneNumber?: string;
          name?: string;
          notify?: string;
          imgUrl?: string | null;
        }[],
      ) => {
        const known = list.filter(
          (c): c is typeof c & { id: string } => !!c.id,
        );
        this.learnContacts(s, known);
        // Troca/remoção de foto: atualiza na hora (sem esperar o ciclo diário).
        for (const c of known) {
          if (c.imgUrl === undefined) continue;
          const jid = s.store.resolve(c.id);
          void this.refreshAvatar(
            s,
            sock,
            contactIdentifierFor(jid),
            jid,
            true,
          );
        }
      },
    );
    sock.ev.on(
      'chats.upsert',
      (list: { id?: string; name?: string | null }[]) => {
        for (const c of list) {
          if (c.id && c.name) s.store.upsertContact(c.id, { name: c.name });
        }
      },
    );
    sock.ev.on('lid-mapping.update', (m: { lid: string; pn: string }) => {
      s.store.mapLid(m.lid, m.pn);
      const pn = normalizeJid(m.pn);
      void this.syncContact(
        s,
        pn,
        s.store.contacts.get(pn)?.name,
        normalizeJid(m.lid),
      );
    });
  }

  /**
   * Reflete nome/telefone do WhatsApp no contato do app (se já existir).
   * `lidJid`: JID LID antigo do mesmo contato, cujo registro vira o número.
   */
  private async syncContact(
    s: WaSession,
    jid: string,
    name: string | null | undefined,
    lidJid?: string,
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `SELECT public.webhook_sync_contact($1,$2,$3,$4,$5)`,
        [
          s.accountId,
          contactIdentifierFor(jid),
          name?.trim() || null,
          phoneOf(jid),
          lidJid ? contactIdentifierFor(lidJid) : null,
        ],
      );
    } catch (err) {
      this.logger.warn(`sync contact ${jid}: ${(err as Error).message}`);
    }
  }

  private learnContacts(
    s: WaSession,
    list: {
      id: string;
      lid?: string;
      phoneNumber?: string;
      name?: string;
      notify?: string;
      imgUrl?: string | null;
    }[],
  ): void {
    for (const c of list) {
      // Contatos do Baileys 7 trazem id (LID ou PN) e o par correspondente.
      if (c.lid && c.phoneNumber) s.store.mapLid(c.lid, c.phoneNumber);
      else if (isLidJid(c.id) && c.phoneNumber)
        s.store.mapLid(c.id, c.phoneNumber);
      s.store.upsertContact(c.id, {
        name: c.name || c.notify || null,
        picture: c.imgUrl && c.imgUrl !== 'changed' ? c.imgUrl : undefined,
      });
      // Nome da agenda/perfil mudou: reflete nos contatos já cadastrados.
      const jid = s.store.resolve(c.id);
      if (!isGroupJid(jid) && (c.name || c.notify))
        void this.syncContact(
          s,
          jid,
          c.name || c.notify,
          isLidJid(c.id) && !isLidJid(jid) ? normalizeJid(c.id) : undefined,
        );
    }
  }

  // ─── mensagens ─────────────────────────────────────────────────────────

  private async handleMessage(
    s: WaSession,
    sock: WASocket,
    B: Baileys,
    msg: WAMessage,
  ): Promise<void> {
    const key = msg.key;
    const remoteJid = key?.remoteJid ?? '';
    const messageId = key?.id ?? '';
    if (!key || !remoteJid || !messageId) return;
    if (remoteJid.includes('@broadcast') || remoteJid.endsWith('@newsletter'))
      return;
    // O Baileys precisa reencontrar esta mensagem (via `getMessage`) para
    // decifrar uma eventual edição futura dela pelo contato (usa o
    // `messageContextInfo.messageSecret` da mensagem ORIGINAL).
    s.store.remember(messageId, msg);
    const isGroup = isGroupJid(remoteJid);

    const sec = (
      msg.message as { secretEncryptedMessage?: SecretEdit | null } | null
    )?.secretEncryptedMessage;
    if (
      sec?.secretEncType ===
      B.proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
    ) {
      await this.applyEncryptedEdit(s, sock, B, msg, sec);
      return;
    }

    const content = B.normalizeMessageContent(msg.message) as
      WaContent | undefined;
    if (!content) return;
    const type = B.getContentType(content);
    if (!type || !ACCEPTED_TYPES.has(type)) return;

    const reply = this.interactiveReply(content);
    const text = this.textOf(content) || reply?.text || '';
    const media = MEDIA_KEYS.find(([k]) => !!content[k]);
    if (!text.trim() && !media) return;

    // Resolve LID → telefone antes de qualquer gravação.
    const alt =
      (key as { remoteJidAlt?: string | null }).remoteJidAlt ?? undefined;
    const jid = isGroup
      ? normalizeJid(remoteJid)
      : await this.resolveJid(s, sock, remoteJid, alt);
    const identifier = contactIdentifierFor(jid);
    const fromMe = key.fromMe === true;
    // Remetente real: em grupo é o participante; no privado, o próprio contato.
    const participantJid = isGroup
      ? await this.resolveJid(
          s,
          sock,
          key.participant ?? '',
          (key as { participantAlt?: string | null }).participantAlt ??
            undefined,
        )
      : jid;
    if (msg.pushName && !fromMe)
      s.store.upsertContact(participantJid, { name: msg.pushName });
    if (!isGroup) void this.subscribePresence(s, jid);
    if (!fromMe || isGroup) void this.refreshAvatar(s, sock, identifier, jid);
    const groupName = isGroup ? await this.groupName(s, sock, jid) : null;
    // Antes do ingest: migra contato LID→telefone (evita duplicar) e atualiza o nome.
    await this.syncContact(
      s,
      jid,
      isGroup
        ? groupName
        : (s.store.contacts.get(jid)?.name ??
            (fromMe ? null : (msg.pushName ?? null))),
      isLidJid(remoteJid) && !isLidJid(jid)
        ? normalizeJid(remoteJid)
        : undefined,
    );

    let contentAttributes: Record<string, unknown> | undefined;
    let audio: { buffer: Buffer; mime: string } | undefined;
    if (media) {
      const info = content[media[0]] ?? {};
      contentAttributes = {
        kind: media[1],
        mime: info.mimetype ?? undefined,
        filename: info.fileName ?? undefined,
        caption: info.caption || undefined,
      };
      try {
        const buffer = (await B.downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: console as never,
            reuploadRequest: sock.updateMediaMessage,
          },
        )) as Buffer;
        const ext = (info.mimetype ?? '').split('/')[1]?.split(';')[0];
        const objectKey = `${s.accountId}/incoming/${messageId}${ext ? `.${ext}` : ''}`;
        await this.storage.uploadObject(
          this.storage.attachmentsBucket,
          objectKey,
          buffer,
          info.mimetype ?? undefined,
        );
        contentAttributes.storage_path = `${this.storage.attachmentsBucket}/${objectKey}`;
        if (media[1] === 'audio')
          audio = { buffer, mime: info.mimetype ?? 'audio/ogg' };
      } catch (err) {
        this.logger.warn(`media ${messageId}: ${(err as Error).message}`);
      }
    } else if (reply) {
      contentAttributes = {
        kind: 'interactive_reply',
        selected_id: reply.selectedId,
      };
    }
    if (isGroup && !fromMe && participantJid) {
      contentAttributes = {
        kind: 'text',
        ...contentAttributes,
        sender: {
          jid: participantJid,
          name:
            msg.pushName ?? s.store.contacts.get(participantJid)?.name ?? null,
          avatar_url: `storage:${this.storage.attachmentsBucket}/${this.avatarKey(s.accountId, participantJid)}`,
        },
      };
      void this.refreshAvatar(
        s,
        sock,
        contactIdentifierFor(participantJid),
        participantJid,
      );
    }
    const quote = this.quoteOf(s, sock, content, jid, B);
    if (quote) {
      contentAttributes = {
        kind: 'text',
        ...contentAttributes,
        reply_to: quote,
      };
    }

    const body = text.trim() || (media ? `[${media[1]}]` : '');

    // Enviada pelo celular do atendente (ou eco do nosso próprio envio).
    if (fromMe) {
      await this.dataSource.query(
        `SELECT public.webhook_ingest_outbound_message($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          s.channelId,
          identifier,
          messageId,
          body,
          media ? 1 : 0,
          JSON.stringify(contentAttributes ?? { kind: 'text' }),
        ],
      );
      if (audio) void this.transcribeAudio(s, messageId, audio);
      return;
    }

    await this.inbound.ingest({
      accountId: s.accountId,
      channelId: s.channelId,
      channelType: 'whatsapp',
      inboxName: 'WhatsApp',
      identifier,
      contactName: isGroup
        ? (groupName ?? 'Grupo')
        : (msg.pushName ?? 'WhatsApp (sem número)'),
      contactPhone: phoneOf(jid),
      sourceId: messageId,
      content: body,
      hasMedia: !!media,
      contentAttributes,
      externalSourceIds: { wa_message_id: messageId },
    });
    if (audio) void this.transcribeAudio(s, messageId, audio);
  }

  /** STT automático: grava o texto em content_attributes.transcript (melhor esforço). */
  private async transcribeAudio(
    s: WaSession,
    messageId: string,
    audio: { buffer: Buffer; mime: string },
  ): Promise<void> {
    if (!this.speech.enabled) return;
    const out = await this.speech.transcribe(audio.buffer, audio.mime);
    if (!out) return;
    try {
      await this.dataSource.query(
        `SELECT public.webhook_set_message_transcript($1,$2,$3)`,
        [s.channelId, messageId, out.text],
      );
    } catch (err) {
      this.logger.warn(`transcript ${messageId}: ${(err as Error).message}`);
    }
  }

  /** LID → JID de telefone: alt do payload, mapa aprendido e repositório do Baileys. */
  private async resolveJid(
    s: WaSession,
    sock: WASocket,
    remoteJid: string,
    alt?: string,
  ): Promise<string> {
    if (!remoteJid) return '';
    const jid = normalizeJid(remoteJid);
    if (!isLidJid(jid)) return jid;
    if (alt && isPnJid(alt)) {
      s.store.mapLid(jid, alt);
      return normalizeJid(alt);
    }
    const known = s.store.lidToPn.get(jid);
    if (known) return known;
    try {
      const repo = (
        sock as unknown as {
          signalRepository?: {
            lidMapping?: {
              getPNForLID?: (lid: string) => Promise<string | null>;
            };
          };
        }
      ).signalRepository?.lidMapping;
      const pn = await repo?.getPNForLID?.(jid);
      if (pn && isPnJid(pn)) {
        s.store.mapLid(jid, pn);
        return normalizeJid(pn);
      }
    } catch {
      /* sem mapeamento ainda */
    }
    return jid;
  }

  private subscribePresence(s: WaSession, jid: string): Promise<void> {
    return this.waSend.subscribePresence(s.channelId, jid).catch(() => {
      /* presença é best-effort */
    });
  }

  /** Chave (no bucket de anexos) da foto de perfil de um JID. */
  avatarKey(accountId: string, jid: string): string {
    return `${accountId}/avatars/${normalizeJid(jid).replace(/[^\w-]/g, '_')}.jpg`;
  }

  /**
   * Baixa a foto de perfil e guarda no storage (a URL do WhatsApp expira).
   * Devolve `storage:<bucket>/<key>`, a URL original se o upload falhar, ou
   * null se o contato não tem foto/ocultou.
   */
  private async persistAvatar(
    s: WaSession,
    sock: WASocket,
    jid: string,
  ): Promise<string | null> {
    const url = await sock.profilePictureUrl(jid, 'image');
    s.store.setContactPicture(jid, url ?? null);
    if (!url) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const key = this.avatarKey(s.accountId, jid);
      await this.storage.uploadObject(
        this.storage.attachmentsBucket,
        key,
        Buffer.from(await res.arrayBuffer()),
        res.headers.get('content-type') ?? 'image/jpeg',
      );
      return `storage:${this.storage.attachmentsBucket}/${key}`;
    } catch (err) {
      this.logger.warn(`avatar ${jid}: ${(err as Error).message}`);
      return url as string;
    }
  }

  /** Foto de perfil: no máx. 1 consulta/dia por contato (ou na hora, com `force`). */
  private async refreshAvatar(
    s: WaSession,
    sock: WASocket,
    identifier: string,
    jid: string,
    force = false,
  ): Promise<void> {
    const key = `${s.accountId}:${identifier}:${s.store.epoch}`;
    if (
      !force &&
      Date.now() - (this.avatarChecked.get(key) ?? 0) < 24 * 60 * 60 * 1000
    )
      return;
    this.avatarChecked.set(key, Date.now());
    try {
      const url = await this.persistAvatar(s, sock, jid);
      if (!url) return;
      // O contato só existe depois do ingest; tenta de novo após um instante.
      for (const wait of [1500, 5000]) {
        await new Promise((r) => setTimeout(r, wait));
        const rows = await this.dataSource.query<{ ok: boolean }[]>(
          `SELECT public.webhook_set_contact_avatar($1,$2,$3) AS ok`,
          [s.accountId, identifier, url],
        );
        if (rows[0]?.ok) return;
      }
    } catch {
      // Sem foto / privacidade: tenta de novo só amanhã.
    }
  }

  /** Texto/legenda de um conteúdo já normalizado. */
  /**
   * Edição E2EE (`secretEncryptedMessage` MESSAGE_EDIT). O decrypt do Baileys
   * monta a chave com o "remetente original" lido de `targetMessageKey`, que
   * vem do ponto de vista de quem editou (fromMe=true, remoteJid = nós) — e
   * por isso deriva a chave errada e falha. Só o autor pode editar, então
   * remetente original = editor; tentamos as formas PN e LID do autor.
   */
  private async applyEncryptedEdit(
    s: WaSession,
    sock: WASocket,
    B: Baileys,
    msg: WAMessage,
    sec: SecretEdit,
  ): Promise<void> {
    const targetId = sec.targetMessageKey?.id;
    if (!targetId || !sec.encPayload || !sec.encIv) return;
    const secret =
      s.store.getCached(targetId)?.message?.messageContextInfo?.messageSecret;
    if (!secret) {
      this.logger.warn(`edit ${targetId}: original fora do cache, sem messageSecret`);
      return;
    }

    const key = msg.key as WAMessage['key'] & {
      remoteJidAlt?: string | null;
      participantAlt?: string | null;
    };
    const me = sock.user as { id?: string; lid?: string } | undefined;
    const raw = key.fromMe
      ? [me?.id, me?.lid]
      : [key.participantAlt, key.participant, key.remoteJidAlt, key.remoteJid];
    const authors = [
      ...new Set(
        raw
          .filter((j): j is string => !!j && !isGroupJid(j))
          .map((j) => B.jidNormalizedUser(j)),
      ),
    ];

    for (const author of authors) {
      let inner: WaContent | null | undefined;
      try {
        inner = B.decryptMessageEdit(
          { encPayload: sec.encPayload, encIv: sec.encIv },
          {
            originalSenderJid: author,
            originalMsgId: targetId,
            editEncKey: secret,
            editorJid: author,
          },
        )?.protocolMessage?.editedMessage as WaContent | null | undefined;
      } catch {
        continue;
      }
      const text = inner ? this.textOf(inner) : '';
      if (!text) return;
      await this.dataSource.query(
        `SELECT public.webhook_apply_message_edit($1,$2,$3)`,
        [s.channelId, targetId, text],
      );
      this.logger.log(`edit ${targetId}: aplicada (autor ${author})`);
      return;
    }
    this.logger.warn(`edit ${targetId}: decrypt falhou para ${authors.join(', ')}`);
  }

  private textOf(content: WaContent): string {
    return (
      (typeof content.conversation === 'string' && content.conversation) ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      ''
    );
  }

  /** Nome do grupo (cache do store → metadados do WhatsApp). */
  private async groupName(
    s: WaSession,
    sock: WASocket,
    jid: string,
  ): Promise<string | null> {
    const cached = s.store.groups.get(jid)?.name;
    if (cached) return cached;
    try {
      const meta = (await sock.groupMetadata(jid)) as {
        subject?: string;
        participants?: unknown[];
      };
      if (meta.subject) {
        s.store.groups.set(jid, {
          jid,
          name: meta.subject,
          size: meta.participants?.length ?? 0,
          picture: null,
          pictureAt: null,
        });
        return meta.subject;
      }
    } catch {
      /* sem metadados: usa o nome genérico */
    }
    return null;
  }

  /** Mensagem citada quando o contato usa "responder". */
  private quoteOf(
    s: WaSession,
    sock: WASocket,
    content: WaContent,
    chatJid: string,
    B: Baileys,
  ): Quote | null {
    const ctx =
      content.extendedTextMessage?.contextInfo ?? this.ctxOf(content, B);
    if (!ctx?.stanzaId) return null;
    const q = ctx.quotedMessage;
    const text =
      q?.conversation ||
      q?.extendedTextMessage?.text ||
      q?.imageMessage?.caption ||
      q?.videoMessage?.caption ||
      q?.documentMessage?.caption ||
      null;
    const mediaKind = q
      ? MEDIA_KEYS.find(([k]) => !!(q as Record<string, unknown>)[k])?.[1]
      : undefined;
    // Autor da citação: compara JIDs resolvidos (LID → telefone) com o dono
    // da sessão; no privado, quem não é o contato foi uma mensagem nossa.
    const author = s.store.resolve(ctx.participant ?? chatJid);
    const user = (sock as unknown as { user?: { id?: string; lid?: string } })
      .user;
    const mine = [user?.id, user?.lid]
      .filter((j): j is string => !!j)
      .map((j) => digitsOf(s.store.resolve(j)));
    const fromMe = mine.includes(digitsOf(author));
    return {
      message_id: ctx.stanzaId,
      content: text ? text.slice(0, 200) : null,
      from_me: fromMe,
      media_kind: mediaKind,
      author_name: fromMe
        ? undefined
        : (s.store.contacts.get(author)?.name ?? undefined),
    };
  }

  /** contextInfo dos tipos de mídia (imagem/vídeo/documento/áudio). */
  private ctxOf(content: WaContent, B: Baileys) {
    const t = B.getContentType(content);
    return t
      ? ((content as Record<string, { contextInfo?: unknown }>)[t]
          ?.contextInfo as
          | NonNullable<
              NonNullable<WaContent['extendedTextMessage']>['contextInfo']
            >
          | undefined)
      : undefined;
  }

  /** Texto legível de uma resposta a botão/lista. */
  private interactiveReply(content: WaContent): Reply | null {
    const b = content.buttonsResponseMessage;
    if (b)
      return {
        text: b.selectedDisplayText || b.selectedButtonId || '',
        selectedId: b.selectedButtonId ?? undefined,
      };
    const l = content.listResponseMessage;
    if (l)
      return {
        text: l.title || '',
        selectedId: l.singleSelectReply?.selectedRowId ?? undefined,
      };
    const t = content.templateButtonReplyMessage;
    if (t)
      return {
        text: t.selectedDisplayText || '',
        selectedId: t.selectedId ?? undefined,
      };
    const i = content.interactiveResponseMessage;
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
      return { text: i.body?.text || '', selectedId };
    }
    return null;
  }
}
