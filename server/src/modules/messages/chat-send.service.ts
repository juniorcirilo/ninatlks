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
} from '../evolution/evolution-client.service';

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
  ) {}

  async send(
    accountId: string,
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<{ ok: true; message_id: string; provider_id?: string }> {
    const text = content.trim();
    if (!text) throw new BadRequestException('content required');

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

    let targetNumber = contact.phone_number ?? '';
    if (!targetNumber && contact.identifier) {
      const m = /evolution:whatsapp:([^@:]+)/.exec(contact.identifier);
      if (m) targetNumber = m[1];
    }
    if (!targetNumber) throw new ConflictException('no destination number');

    let providerId: string | undefined;
    try {
      const res = await this.evolutionClient.sendText({
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number: targetNumber,
        text,
      });
      providerId = res.messageId;
    } catch (err) {
      const msg = err instanceof EvolutionError ? err.message : String(err);
      throw new BadGatewayException(msg.slice(0, 500));
    }

    const insertedRows = await this.tx.manager.query<{ id: string }[]>(
      `INSERT INTO messages
         (account_id, inbox_id, conversation_id, content, message_type, sender_type, sender_id,
          content_type, private, source_id, additional_attributes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'User', $5, 0, false, $6, $7::jsonb, now(), now())
       RETURNING id`,
      [
        accountId,
        conv.inbox_id,
        conv.id,
        text,
        userId,
        providerId ?? null,
        JSON.stringify({ sent_via: 'live_chat', operator: userId }),
      ],
    );
    const messageId = insertedRows[0].id;

    await this.tx.manager.query(
      `UPDATE conversations SET last_activity_at = now() WHERE id = $1`,
      [conv.id],
    );

    return { ok: true, message_id: messageId, provider_id: providerId };
  }
}
