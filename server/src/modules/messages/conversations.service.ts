import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

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
  constructor(private readonly tx: TenantTxHost) {}

  async list(
    accountId: string,
    contactId?: string,
  ): Promise<ConversationListItem[]> {
    const rows = await this.tx.manager.query<ConversationListItem[]>(
      `SELECT c.id, c.contact_id, c.inbox_id, c.status, c.ai_autopilot_enabled,
              c.additional_attributes, c.last_activity_at, c.agent_last_seen_at,
              ct.name AS contact_name, ct.phone_number AS contact_phone,
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
              content_attributes, created_at
         FROM messages
        WHERE conversation_id = $1 AND account_id = $2
          AND ($3::timestamptz IS NULL OR created_at < $3::timestamptz)
        ORDER BY created_at DESC
        LIMIT $4`,
      [conversationId, accountId, before ?? null, limit],
    );
    return rows.reverse();
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
}
