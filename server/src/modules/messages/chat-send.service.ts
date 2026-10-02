import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  EvolutionClientService,
  EvolutionError,
  type InteractiveButton,
  type InteractiveSection,
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
      const m = /evolution:whatsapp:([^@:]+)/.exec(contact.identifier);
      if (m) number = m[1];
    }
    if (!number) throw new ConflictException('no destination number');

    return { conv, number, cfg: cfg as Required<EvolutionChannelConfig> };
  }

  private async deliver(fn: () => Promise<{ messageId?: string }>) {
    try {
      return (await fn()).messageId;
    } catch (err) {
      const msg = err instanceof EvolutionError ? err.message : String(err);
      throw new BadGatewayException(msg.slice(0, 500));
    }
  }

  private async record(args: {
    accountId: string;
    userId: string;
    conv: ConversationRow;
    content: string;
    contentType: 0 | 1 | 2;
    contentAttributes: Record<string, unknown>;
    providerId?: string;
  }): Promise<string> {
    const rows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO messages
         (account_id, inbox_id, conversation_id, content, message_type, sender_type, sender_id,
          content_type, content_attributes, private, source_id, additional_attributes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'User', $5, $6, $7::jsonb, false, $8, $9::jsonb, now(), now())
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
        JSON.stringify({ sent_via: 'live_chat', operator: args.userId }),
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
  ): Promise<{ ok: true; message_id: string; provider_id?: string }> {
    const text = content.trim();
    if (!text) throw new BadRequestException('content required');
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      conversationId,
    );
    const providerId = await this.deliver(() =>
      this.evolutionClient.sendText({
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
      contentAttributes: { kind: 'text' },
      providerId,
    });
    return { ok: true, message_id: messageId, provider_id: providerId };
  }

  async sendMedia(
    accountId: string,
    userId: string,
    conversationId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
    caption?: string,
  ): Promise<{ ok: true; message_id: string; provider_id?: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('file required');
    const { conv, number, cfg } = await this.resolveTarget(
      accountId,
      conversationId,
    );
    const mime = file.mimetype || 'application/octet-stream';
    const mediatype = mediatypeOf(mime);
    const fileName = file.originalname.replace(/[^\w.\- ]/g, '_');
    const text = (caption ?? '').trim();

    const providerId = await this.deliver(() =>
      this.evolutionClient.sendMedia({
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

    // Guarda uma cópia para o histórico; falha aqui não desfaz o envio.
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
      contentAttributes: {
        kind: mediatype,
        mime,
        filename: fileName,
        size: file.buffer.length,
        caption: text || undefined,
        storage_path: storagePath,
      },
      providerId,
    });
    return { ok: true, message_id: messageId, provider_id: providerId };
  }

  async sendInteractive(
    accountId: string,
    userId: string,
    conversationId: string,
    input: InteractiveInput,
  ): Promise<{ ok: true; message_id: string; provider_id?: string }> {
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
    const providerId = await this.deliver(() =>
      input.kind === 'buttons'
        ? this.evolutionClient.sendButtons({
            ...base,
            title: input.title,
            description: input.description,
            footer: input.footer,
            buttons: input.buttons,
          })
        : this.evolutionClient.sendList({
            ...base,
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
      contentAttributes: { ...input },
      providerId,
    });
    return { ok: true, message_id: messageId, provider_id: providerId };
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
