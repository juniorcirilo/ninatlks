import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  EvolutionClientService,
  EvolutionError,
  type InteractiveButton,
  type InteractiveSection,
  type QuotedRef,
} from '../evolution/evolution-client.service';
import { StorageService } from '../storage/storage.service';

interface ConversationRow {
  id: string;
  account_id: string;
  inbox_id: string;
  contact_id: string;
}
interface ContactRow {
  id: string;
  name: string | null;
  phone_number: string | null;
  identifier: string | null;
}
interface InboxRow {
  id: string;
  channel_id: string | null;
  channel_type: string | null;
}
interface Target {
  conv: ConversationRow;
  number: string;
  cfg: Required<EvolutionChannelConfig>;
}

export type InteractiveInput =
  | {
      kind: 'buttons';
      title: string;
      description: string;
      footer?: string;
      buttons: InteractiveButton[];
    }
  | {
      kind: 'list';
      title: string;
      description?: string;
      footer?: string;
      buttonText: string;
      sections: InteractiveSection[];
    };

export type SendResult =
  | { ok: true; message_id: string; provider_id?: string }
  | { ok: false; message_id: string; error: string };

/** Atributos guardados em messages.content_attributes (parcial). */
interface StoredAttrs {
  kind?: string;
  mime?: string;
  filename?: string;
  caption?: string;
  storage_path?: string;
  title?: string;
  description?: string;
  footer?: string;
  buttons?: InteractiveButton[];
  buttonText?: string;
  sections?: InteractiveSection[];
  reply_to?: { message_id?: string };
}

export interface SendOpts {
  /** id (interno) da mensagem respondida */
  replyTo?: string;
  forwarded?: boolean;
}

interface QuotedInfo {
  ref: QuotedRef;
  attr: { message_id: string; content: string | null; from_me: boolean };
}

function mediatypeOf(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

interface EvolutionChannelConfig {
  evolution_url?: string;
  evolution_api_key?: string;
  evolution_instance_name?: string;
}

/**
 * Ported from supabase/functions/chat-send-message/index.ts — operator
 * sends a manual WhatsApp message via Evolution from the Live Chat UI.
 */
@Injectable({ scope: Scope.REQUEST })
export class ChatSendService {
  private readonly logger = new Logger(ChatSendService.name);

  constructor(
    private readonly tx: TenantTxHost,
    private readonly evolutionClient: EvolutionClientService,
    private readonly storage: StorageService,
  ) {}

  /** Resolve conversa → número de destino + credenciais do Evolution. */
  private async resolveTarget(
    accountId: string,
    conversationId: string,
  ): Promise<Target> {
    const convRows = await this.tx.manager.query<ConversationRow[]>(
      `SELECT id, account_id, inbox_id, contact_id FROM conversations WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [conversationId, accountId],
    );
    const conv = convRows[0];
    if (!conv) throw new NotFoundException('conversation not found');

    const contactRows = await this.tx.manager.query<ContactRow[]>(
      `SELECT id, name, phone_number, identifier FROM contacts WHERE id = $1 LIMIT 1`,
      [conv.contact_id],
    );
    const contact = contactRows[0];
    if (!contact?.phone_number && !contact?.identifier) {
      throw new ConflictException('contact has no phone');
    }

    const inboxRows = await this.tx.manager.query<InboxRow[]>(
      `SELECT id, channel_id, channel_type FROM inboxes WHERE id = $1 LIMIT 1`,
      [conv.inbox_id],
    );
    const inbox = inboxRows[0];
    if (!inbox || inbox.channel_type !== 'whatsapp') {
      throw new ConflictException('inbox is not a whatsapp channel');
    }

    let cfg: EvolutionChannelConfig | null = null;
    if (inbox.channel_id) {
      const rows = await this.tx.manager.query<
        { config: EvolutionChannelConfig }[]
      >(`SELECT config FROM channels WHERE id = $1 LIMIT 1`, [
        inbox.channel_id,
      ]);
      cfg = rows[0]?.config ?? null;
    }
    if (!cfg) {
      const rows = await this.tx.manager.query<
        { config: EvolutionChannelConfig }[]
      >(
        `SELECT config FROM channels WHERE account_id = $1 AND channel_type = 'whatsapp' AND enabled = true LIMIT 1`,
        [accountId],
      );
      cfg = rows[0]?.config ?? null;
    }
    if (
      !cfg?.evolution_url ||
      !cfg?.evolution_api_key ||
      !cfg?.evolution_instance_name
    ) {
      throw new ConflictException('WhatsApp channel not configured');
    }

    let number = contact.phone_number ?? '';
    if (!number && contact.identifier) {
      const m = /evolution:whatsapp:(\d+(?:@lid)?)/.exec(contact.identifier);
      if (m) number = m[1];
    }
    if (!number) throw new ConflictException('no destination number');

    return { conv, number, cfg: cfg as Required<EvolutionChannelConfig> };
  }

  /**
   * Não lança: a falha é gravada como mensagem com delivery_status = 'error'
   * (a transação do request só persiste se a resposta for bem-sucedida), e o
   * resultado volta com ok:false para a UI mostrar o erro no balão.
   */
  private async deliver(
    fn: () => Promise<{ messageId?: string }>,
  ): Promise<{ providerId?: string; error?: string }> {
    try {
      return { providerId: (await fn()).messageId };
    } catch (err) {
      const msg = err instanceof EvolutionError ? err.message : String(err);
      this.logger.warn(`evolution send failed: ${msg.slice(0, 500)}`);
      return { error: msg.slice(0, 500) };
    }
  }

  private result(
    messageId: string,
    sent: { providerId?: string; error?: string },
  ): SendResult {
    return sent.error
      ? { ok: false, message_id: messageId, error: sent.error }
      : { ok: true, message_id: messageId, provider_id: sent.providerId };
  }

  private async record(args: {
    accountId: string;
    userId: string;
    conv: ConversationRow;
    content: string;
    contentType: 0 | 1 | 2;
    contentAttributes: Record<string, unknown>;
    providerId?: string;
    /** sent (aceita pelo Evolution) ou error (falha no envio). */
    status?: 'sent' | 'error';
    error?: string;
  }): Promise<string> {
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO messages
         (account_id, inbox_id, conversation_id, content, message_type, sender_type, sender_id,
          content_type, content_attributes, private, source_id, additional_attributes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'User', $5, $6, $7::jsonb, false, $8, $9::jsonb, now(), now())
       ON CONFLICT (account_id, source_id) WHERE source_id IS NOT NULL AND source_id <> ''
       DO UPDATE SET content = EXCLUDED.content, content_type = EXCLUDED.content_type,
         content_attributes = EXCLUDED.content_attributes, sender_id = EXCLUDED.sender_id,
         additional_attributes = EXCLUDED.additional_attributes
       RETURNING id`,
      [
        args.accountId,
        args.conv.inbox_id,
        args.conv.id,
        args.content,
        args.userId,
        args.contentType,
        JSON.stringify(args.contentAttributes),
        args.providerId ?? null,
        JSON.stringify({
          sent_via: 'live_chat',
          operator: args.userId,
          delivery_status: args.status ?? 'sent',
          ...(args.error ? { delivery_error: args.error } : {}),
        }),
      ],
    );
    await this.tx.manager.query(
      `UPDATE conversations SET last_activity_at = now() WHERE id = $1`,
      [args.conv.id],
    );
    return rows[0].id;
  }

  async send(
    accountId: string,
    userId: string,
    conversationId: string,
    content: string,
    opts: SendOpts = {},
  ): Promise<SendResult> {
    const text = content.trim();
    if (!text) throw new BadRequestException('content required');
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      conversationId,
    );
    const quoted = await this.quotedFor(accountId, conv, number, opts.replyTo);
    const sent = await this.deliver(() =>
      this.evolutionClient.sendText({
        quoted: quoted?.ref,
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number,
        text,
      }),
    );
    const messageId = await this.record({
      accountId,
      userId,
      conv,
      content: text,
      contentType: 0,
      contentAttributes: this.extras({ kind: 'text' }, quoted, opts),
      providerId: sent.providerId,
      status: sent.error ? 'error' : 'sent',
      error: sent.error,
    });
    return this.result(messageId, sent);
  }

  async sendMedia(
    accountId: string,
    userId: string,
    conversationId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    caption?: string,
    opts: SendOpts = {},
  ): Promise<SendResult> {
    if (!file?.buffer?.length) throw new BadRequestException('file required');
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      conversationId,
    );
    const mime = file.mimetype || 'application/octet-stream';
    const mediatype = mediatypeOf(mime);
    const fileName = file.originalname.replace(/[^\w.\- ]/g, '_');
    const text = (caption ?? '').trim();

    const quoted = await this.quotedFor(accountId, conv, number, opts.replyTo);
    const sent = await this.deliver(() =>
      this.evolutionClient.sendMedia({
        quoted: quoted?.ref,
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number,
        mediatype,
        mimetype: mime,
        media: file.buffer.toString('base64'),
        fileName,
        caption: text || undefined,
      }),
    );

    // Guarda uma cópia (histórico e reenvio se falhou); falha aqui não desfaz o envio.
    let storagePath: string | undefined;
    try {
      const key = `${accountId}/outgoing/${conv.id}/${Date.now()}-${fileName}`;
      await this.storage.uploadObject(
        this.storage.attachmentsBucket,
        key,
        file.buffer,
        mime,
      );
      storagePath = `${this.storage.attachmentsBucket}/${key}`;
    } catch {
      /* mensagem já enviada */
    }

    const messageId = await this.record({
      accountId,
      userId,
      conv,
      content: text || `[${mediatype}] ${fileName}`,
      contentType: 1,
      contentAttributes: this.extras(
        {
          kind: mediatype,
          mime,
          filename: fileName,
          size: file.buffer.length,
          caption: text || undefined,
          storage_path: storagePath,
        },
        quoted,
        opts,
      ),
      providerId: sent.providerId,
      status: sent.error ? 'error' : 'sent',
      error: sent.error,
    });
    return this.result(messageId, sent);
  }

  async sendInteractive(
    accountId: string,
    userId: string,
    conversationId: string,
    input: InteractiveInput,
    opts: SendOpts = {},
  ): Promise<SendResult> {
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      conversationId,
    );
    const base = {
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
      number,
    };
    const quoted = await this.quotedFor(accountId, conv, number, opts.replyTo);
    const sent = await this.deliver(() =>
      input.kind === 'buttons'
        ? this.evolutionClient.sendButtons({
            ...base,
            quoted: quoted?.ref,
            title: input.title,
            description: input.description,
            footer: input.footer,
            buttons: input.buttons,
          })
        : this.evolutionClient.sendList({
            ...base,
            quoted: quoted?.ref,
            title: input.title,
            description: input.description,
            footerText: input.footer,
            buttonText: input.buttonText,
            sections: input.sections,
          }),
    );
    const messageId = await this.record({
      accountId,
      userId,
      conv,
      content:
        input.kind === 'buttons'
          ? `${input.title}\n${input.description}`.trim()
          : `${input.title}${input.description ? `\n${input.description}` : ''}`,
      contentType: 2,
      contentAttributes: this.extras({ ...input }, quoted, opts),
      providerId: sent.providerId,
      status: sent.error ? 'error' : 'sent',
      error: sent.error,
    });
    return this.result(messageId, sent);
  }

  private extras(
    attrs: Record<string, unknown>,
    quoted: QuotedInfo | null,
    opts: SendOpts,
  ): Record<string, unknown> {
    return {
      ...attrs,
      ...(quoted ? { reply_to: quoted.attr } : {}),
      ...(opts.forwarded ? { forwarded: true } : {}),
    };
  }

  /** Monta a referência de resposta (citação) a partir de uma mensagem desta conversa. */
  private async quotedFor(
    accountId: string,
    conv: ConversationRow,
    number: string,
    replyTo?: string,
  ): Promise<QuotedInfo | null> {
    if (!replyTo) return null;
    const rows = await this.tx.manager.query<
      {
        id: string;
        content: string | null;
        source_id: string | null;
        message_type: number;
      }[]
    >(
      `SELECT id, content, source_id, message_type FROM messages
        WHERE id = $1 AND account_id = $2 AND conversation_id = $3 LIMIT 1`,
      [replyTo, accountId, conv.id],
    );
    const m = rows[0];
    if (!m) throw new NotFoundException('message to reply not found');
    // Sem id do WhatsApp (ex.: envio que falhou) não há o que citar.
    if (!m.source_id) throw new ConflictException('message cannot be quoted');
    const remoteJid = number.includes('@')
      ? number
      : `${number.replace(/\D/g, '')}@s.whatsapp.net`;
    const fromMe = m.message_type === 1;
    return {
      ref: {
        key: { id: m.source_id, remoteJid, fromMe },
        message: m.content
          ? { conversation: m.content.slice(0, 500) }
          : undefined,
      },
      attr: {
        message_id: m.id,
        content: m.content ? m.content.slice(0, 200) : null,
        from_me: fromMe,
      },
    };
  }

  /**
   * Reenvia uma mensagem que falhou, reaproveitando o mesmo registro (o balão
   * vermelho vira "enviada"; nada é duplicado na conversa).
   */
  async resend(
    accountId: string,
    userId: string,
    messageId: string,
  ): Promise<SendResult> {
    void userId;
    const rows = await this.tx.manager.query<
      {
        id: string;
        conversation_id: string;
        content: string | null;
        content_type: number;
        content_attributes: StoredAttrs | null;
        status: string | null;
      }[]
    >(
      `SELECT id, conversation_id, content, content_type, content_attributes,
              additional_attributes->>'delivery_status' AS status
         FROM messages
        WHERE id = $1 AND account_id = $2 AND message_type = 1 LIMIT 1`,
      [messageId, accountId],
    );
    const msg = rows[0];
    if (!msg) throw new NotFoundException('message not found');
    if (msg.status !== 'error') {
      throw new ConflictException('only failed messages can be resent');
    }
    const attrs: StoredAttrs = msg.content_attributes ?? {};
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      msg.conversation_id,
    );
    const base = {
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
      number,
    };
    // Citação é opcional: se a mensagem original sumiu, reenvia sem ela.
    const replyId =
      typeof attrs.reply_to?.message_id === 'string'
        ? attrs.reply_to.message_id
        : undefined;
    let quoted: QuotedInfo | null = null;
    try {
      quoted = await this.quotedFor(accountId, conv, number, replyId);
    } catch {
      quoted = null;
    }

    let sent: { providerId?: string; error?: string };
    if (msg.content_type === 1 && attrs.kind && attrs.kind !== 'text') {
      const path =
        typeof attrs.storage_path === 'string' ? attrs.storage_path : '';
      if (!path.includes(`/${accountId}/`)) {
        throw new ConflictException(
          'o arquivo desta mensagem não foi guardado; envie-o novamente',
        );
      }
      const slash = path.indexOf('/');
      const buffer = await this.storage.getObjectBuffer(
        path.slice(0, slash),
        path.slice(slash + 1),
      );
      const mime = String(attrs.mime ?? 'application/octet-stream');
      sent = await this.deliver(() =>
        this.evolutionClient.sendMedia({
          ...base,
          quoted: quoted?.ref,
          mediatype: mediatypeOf(mime),
          mimetype: mime,
          media: buffer.toString('base64'),
          fileName: String(attrs.filename ?? 'arquivo'),
          caption:
            typeof attrs.caption === 'string' ? attrs.caption : undefined,
        }),
      );
    } else if (attrs.kind === 'buttons') {
      sent = await this.deliver(() =>
        this.evolutionClient.sendButtons({
          ...base,
          quoted: quoted?.ref,
          title: String(attrs.title ?? ''),
          description: String(attrs.description ?? attrs.title ?? ''),
          footer: attrs.footer,
          buttons: attrs.buttons ?? [],
        }),
      );
    } else if (attrs.kind === 'list') {
      sent = await this.deliver(() =>
        this.evolutionClient.sendList({
          ...base,
          quoted: quoted?.ref,
          title: String(attrs.title ?? ''),
          description: attrs.description,
          footerText: attrs.footer,
          buttonText: String(attrs.buttonText ?? 'Ver opções'),
          sections: attrs.sections ?? [],
        }),
      );
    } else {
      sent = await this.deliver(() =>
        this.evolutionClient.sendText({
          ...base,
          quoted: quoted?.ref,
          text: msg.content ?? '',
        }),
      );
    }

    if (sent.error) {
      await this.tx.manager.query(
        `UPDATE messages
            SET additional_attributes = additional_attributes || jsonb_build_object('delivery_error', $2::text),
                updated_at = now()
          WHERE id = $1`,
        [msg.id, sent.error],
      );
      return this.result(msg.id, sent);
    }

    // O eco do webhook pode já ter criado uma linha com este id do WhatsApp.
    if (sent.providerId) {
      await this.tx.manager.query(
        `DELETE FROM messages WHERE account_id = $1 AND source_id = $2 AND id <> $3`,
        [accountId, sent.providerId, msg.id],
      );
    }
    await this.tx.manager.query(
      `UPDATE messages
          SET source_id = COALESCE($2, source_id),
              additional_attributes = (additional_attributes - 'delivery_error')
                                      || jsonb_build_object('delivery_status', 'sent'),
              updated_at = now()
        WHERE id = $1`,
      [msg.id, sent.providerId ?? null],
    );
    await this.tx.manager.query(
      `UPDATE conversations SET last_activity_at = now() WHERE id = $1`,
      [conv.id],
    );
    return this.result(msg.id, sent);
  }

  /** Encaminha uma mensagem (texto, mídia ou interativa) para outras conversas. */
  async forward(
    accountId: string,
    userId: string,
    messageId: string,
    conversationIds: string[],
  ): Promise<{
    ok: boolean;
    results: (SendResult & { conversation_id: string })[];
  }> {
    const rows = await this.tx.manager.query<
      {
        content: string | null;
        content_type: number;
        content_attributes: Record<string, any> | null;
      }[]
    >(
      `SELECT content, content_type, content_attributes FROM messages
        WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [messageId, accountId],
    );
    const src = rows[0];
    if (!src) throw new NotFoundException('message not found');
    const attrs = src.content_attributes ?? {};

    let file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
    } | null = null;
    if (src.content_type === 1 && attrs.kind && attrs.kind !== 'text') {
      const path =
        typeof attrs.storage_path === 'string' ? attrs.storage_path : '';
      // Só lê caminhos desta conta (defesa contra atributo adulterado).
      if (!path.includes(`/${accountId}/`)) {
        throw new ConflictException('attachment unavailable for forwarding');
      }
      const slash = path.indexOf('/');
      file = {
        buffer: await this.storage.getObjectBuffer(
          path.slice(0, slash),
          path.slice(slash + 1),
        ),
        originalname: String(attrs.filename ?? 'arquivo'),
        mimetype: String(attrs.mime ?? 'application/octet-stream'),
      };
    }

    const opts: SendOpts = { forwarded: true };
    const results: (SendResult & { conversation_id: string })[] = [];
    for (const conversationId of conversationIds) {
      let res: SendResult;
      if (file) {
        res = await this.sendMedia(
          accountId,
          userId,
          conversationId,
          file,
          typeof attrs.caption === 'string' ? attrs.caption : undefined,
          opts,
        );
      } else if (attrs.kind === 'buttons' || attrs.kind === 'list') {
        res = await this.sendInteractive(
          accountId,
          userId,
          conversationId,
          attrs as unknown as InteractiveInput,
          opts,
        );
      } else {
        res = await this.send(
          accountId,
          userId,
          conversationId,
          src.content ?? '',
          opts,
        );
      }
      results.push({ ...res, conversation_id: conversationId });
    }
    return { ok: results.every((r) => r.ok), results };
  }

  async sendPresence(
    accountId: string,
    conversationId: string,
    presence: 'composing' | 'recording' | 'paused',
  ): Promise<{ ok: true }> {
    const { number, cfg } = await this.resolveTarget(accountId, conversationId);
    await this.evolutionClient
      .sendPresence({
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number,
        presence,
      })
      // Presença é best-effort: nunca derruba a UI.
      .catch(() => undefined);
    return { ok: true };
  }
}
