import {
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  contactIdentifierFor,
  isGroupJid,
  normalizeJid,
  phoneOf,
} from '../evolution/jid.util';
import { StorageService } from '../storage/storage.service';

export interface ConversationListItem {
  id: string;
  contact_id: string;
  inbox_id: string;
  status: number;
  ai_autopilot_enabled: boolean;
  additional_attributes: Record<string, unknown>;
  last_activity_at: string;
  agent_last_seen_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_avatar: string | null;
  last_message_content: string | null;
  last_message_at: string | null;
  last_message_sender_type: string | null;
  unread: boolean;
}

export interface MessageListItem {
  id: string;
  content: string | null;
  sender_type: string | null;
  message_type: number;
  content_type: number;
  content_attributes: Record<string, unknown>;
  created_at: string;
  /** URL assinada (temporária) do anexo, quando houver. */
  media_url?: string;
  /** sent | delivered | read (só mensagens enviadas). */
  delivery_status?: string | null;
  delivery_error?: string | null;
}

/**
 * Read side of the WhatsApp Live Chat inbox. Sending stays in
 * ChatSendService (POST .../messages/send) — this service only lists
 * conversations/messages and toggles per-conversation flags, all scoped to
 * `inboxes.channel_type = 'whatsapp'` since that's the only text channel
 * with a UI today.
 */
@Injectable({ scope: Scope.REQUEST })
export class ConversationsService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly storage: StorageService,
  ) {}

  async list(
    accountId: string,
    contactId?: string,
  ): Promise<ConversationListItem[]> {
    const rows = await this.tx.manager.query<ConversationListItem[]>(
      `SELECT c.id, c.contact_id, c.inbox_id, c.status, c.ai_autopilot_enabled,
              c.additional_attributes, c.last_activity_at, c.agent_last_seen_at,
              ct.name AS contact_name, ct.phone_number AS contact_phone,
              ct.additional_attributes->>'avatar_url' AS contact_avatar,
              lm.content AS last_message_content, lm.created_at AS last_message_at,
              lm.sender_type AS last_message_sender_type,
              (c.agent_last_seen_at IS NULL OR c.agent_last_seen_at < c.last_activity_at) AS unread
         FROM conversations c
         JOIN inboxes i ON i.id = c.inbox_id
         JOIN contacts ct ON ct.id = c.contact_id
         LEFT JOIN LATERAL (
           SELECT content, created_at, sender_type FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
        WHERE c.account_id = $1
          AND i.channel_type = 'whatsapp'
          AND c.deleted_at IS NULL
          AND ($2::uuid IS NULL OR c.contact_id = $2)
        ORDER BY c.last_activity_at DESC
        LIMIT 200`,
      [accountId, contactId ?? null],
    );
    return rows;
  }

  async messages(
    accountId: string,
    conversationId: string,
    before?: string,
    limit = 50,
  ): Promise<MessageListItem[]> {
    const conv = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM conversations WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [conversationId, accountId],
    );
    if (!conv[0]) throw new NotFoundException('conversation not found');

    const rows = await this.tx.manager.query<MessageListItem[]>(
      `SELECT id, content, sender_type, message_type, content_type,
              content_attributes, created_at,
              additional_attributes->>'delivery_status' AS delivery_status,
              additional_attributes->>'delivery_error' AS delivery_error
         FROM messages
        WHERE conversation_id = $1 AND account_id = $2
          AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)
        ORDER BY created_at DESC
        LIMIT $4`,
      [conversationId, accountId, before ?? null, limit],
    );
    const ordered = rows.reverse();
    await Promise.all(
      ordered.map(async (m) => {
        const path = m.content_attributes?.storage_path;
        // Só assina caminhos desta conta (defesa contra atributo adulterado).
        if (typeof path !== 'string' || !path.includes(`/${accountId}/`))
          return;
        const slash = path.indexOf('/');
        try {
          m.media_url = await this.storage.presignDownload(
            path.slice(slash + 1),
            path.slice(0, slash),
            60 * 60,
          );
        } catch {
          /* sem preview */
        }
      }),
    );
    return ordered;
  }

  async update(
    accountId: string,
    conversationId: string,
    patch: { aiAutopilotEnabled?: boolean; markRead?: boolean },
  ): Promise<{ ok: true }> {
    const conv = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM conversations WHERE id = $1 AND account_id = $2 LIMIT 1`,
      [conversationId, accountId],
    );
    if (!conv[0]) throw new NotFoundException('conversation not found');

    if (patch.aiAutopilotEnabled !== undefined) {
      await this.tx.manager.query(
        `UPDATE conversations SET ai_autopilot_enabled = $3, updated_at = now()
          WHERE id = $1 AND account_id = $2`,
        [conversationId, accountId, patch.aiAutopilotEnabled],
      );
    }
    if (patch.markRead) {
      await this.tx.manager.query(
        `UPDATE conversations SET agent_last_seen_at = now(), updated_at = now()
          WHERE id = $1 AND account_id = $2`,
        [conversationId, accountId],
      );
    }
    return { ok: true };
  }

  /**
   * Abre (ou cria) a conversa de um contato do Evolution identificado pelo JID
   * — o contato pode ainda não existir no app. LID sem telefone resolvido
   * vira `…@lid` (o envio usa o JID completo).
   */
  async startByJid(
    accountId: string,
    input: { jid: string; name?: string; picture?: string },
  ): Promise<{ id: string; created: boolean; contact_id: string }> {
    const jid = normalizeJid(input.jid);
    if (isGroupJid(jid)) {
      throw new ConflictException('group conversations are not supported');
    }
    const identifier = contactIdentifierFor(jid);
    const phone = phoneOf(jid);

    let contact = (
      await this.tx.manager.query<{ id: string }[]>(
        `SELECT id FROM contacts
          WHERE account_id = $1 AND identifier = $2 AND deleted_at IS NULL LIMIT 1`,
        [accountId, identifier],
      )
    )[0];
    if (!contact) {
      contact = (
        await this.tx.manager.query<{ id: string }[]>(
          `INSERT INTO contacts
             (account_id, identifier, name, phone_number, additional_attributes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
           RETURNING id`,
          [
            accountId,
            identifier,
            input.name?.trim() || phone || 'WhatsApp',
            phone,
            JSON.stringify(input.picture ? { avatar_url: input.picture } : {}),
          ],
        )
      )[0];
    } else if (input.picture) {
      await this.tx.manager.query(
        `UPDATE contacts
            SET additional_attributes = additional_attributes || jsonb_build_object('avatar_url', $2::text)
          WHERE id = $1 AND (additional_attributes->>'avatar_url') IS NULL`,
        [contact.id, input.picture],
      );
    }
    const conv = await this.start(accountId, contact.id);
    return { ...conv, contact_id: contact.id };
  }

  /**
   * Find-or-create the open WhatsApp conversation for a contact, so
   * "message this contact" from Central de Contatos has somewhere to send
   * to even before the contact has ever texted in. Mirrors the find-or-create
   * in cadence_whatsapp_record_message (20260807130000-CadenceWhatsappStepBypass)
   * but runs inside the normal tenant-scoped request tx instead of a
   * SECURITY DEFINER function, since this is user-initiated, not a cron job.
   */
  async start(
    accountId: string,
    contactId: string,
  ): Promise<{ id: string; created: boolean }> {
    const contactRows = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM contacts WHERE id = $1 AND account_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [contactId, accountId],
    );
    if (!contactRows[0]) throw new NotFoundException('contact not found');

    const inboxRows = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM inboxes
        WHERE account_id = $1 AND channel_type = 'whatsapp' AND enabled = true
        LIMIT 1`,
      [accountId],
    );
    const inbox = inboxRows[0];
    if (!inbox) throw new ConflictException('WhatsApp channel not configured');

    const existing = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM conversations
        WHERE account_id = $1 AND contact_id = $2 AND inbox_id = $3 AND deleted_at IS NULL
        ORDER BY last_activity_at DESC LIMIT 1`,
      [accountId, contactId, inbox.id],
    );
    if (existing[0]) return { id: existing[0].id, created: false };

    const created = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO conversations
         (account_id, contact_id, inbox_id, status, last_activity_at, created_at, updated_at)
       VALUES ($1, $2, $3, 0, now(), now(), now())
       RETURNING id`,
      [accountId, contactId, inbox.id],
    );
    return { id: created[0].id, created: true };
  }
}
