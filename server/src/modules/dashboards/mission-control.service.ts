import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';

export interface MissionLiveKpis {
  open_conversations: number;
  pending_conversations: number;
  snoozed_conversations: number;
  unassigned_open: number;
  messages_last_hour: number;
  inbound_last_hour: number;
  outbound_last_hour: number;
  handoffs_last_hour: number;
  meetings_last_hour: number;
  agents_on_duty: number;
  avg_first_reply_min: number | null;
}

export interface HotConversation {
  conversation_id: string;
  display_id: number;
  status: number;
  priority: number;
  message_count_2h: number;
  last_activity_at: string;
  contact_name: string | null;
  inbox_name: string | null;
  assignee_id: string | null;
}

export interface HandoffEvent {
  id: string;
  created_at: string;
  reason: string;
  from_name: string | null;
  to_name: string | null;
  to_kind: 'persona' | 'human';
  conversation_id: string;
}

export interface PersonaPulse {
  persona_id: string;
  name: string;
  kind: string;
  status: string;
  messages_last_hour: number;
  handoffs_last_hour: number;
}

export interface MissionControlSnapshot {
  generated_at: string;
  kpis: MissionLiveKpis;
  hot_conversations: HotConversation[];
  recent_handoffs: HandoffEvent[];
  persona_pulse: PersonaPulse[];
}

/** Ported from src/lib/mission-control.functions.ts. */
@Injectable({ scope: Scope.REQUEST })
export class MissionControlService {
  constructor(private readonly tx: TenantTxHost) {}

  async snapshot(accountId: string): Promise<MissionControlSnapshot> {
    const now = Date.now();
    const hourAgo = new Date(now - 3600_000);
    const twoHourAgo = new Date(now - 2 * 3600_000);
    const dayAgo = new Date(now - 24 * 3600_000);

    const [
      statusCounts,
      unassignedRows,
      msgs,
      handoffsHour,
      meetingsRows,
      frRows,
      hotConvIds,
      personasRows,
      recentHandoffsRaw,
    ] = await Promise.all([
      this.tx.manager.query<{ status: number }[]>(
        `SELECT status FROM conversations WHERE account_id = $1 AND status IN (0,2,3)`,
        [accountId],
      ),
      this.tx.manager.query<{ count: string }[]>(
        `SELECT count(*) FROM conversations WHERE account_id = $1 AND status = 0 AND assignee_id IS NULL`,
        [accountId],
      ),
      this.tx.manager.query<
        {
          message_type: number;
          sender_type: string | null;
          sender_id: string | null;
        }[]
      >(
        `SELECT message_type, sender_type, sender_id FROM messages
           WHERE account_id = $1 AND private = false AND created_at >= $2`,
        [accountId, hourAgo],
      ),
      this.tx.manager.query<{ from_persona_id: string | null }[]>(
        `SELECT from_persona_id FROM agent_handoffs WHERE account_id = $1 AND created_at >= $2`,
        [accountId, hourAgo],
      ),
      this.tx.manager.query<{ count: string }[]>(
        `SELECT count(*) FROM scheduled_meetings WHERE account_id = $1 AND created_at >= $2`,
        [accountId, hourAgo],
      ),
      this.tx.manager.query<
        { created_at: string; first_reply_created_at: string }[]
      >(
        `SELECT created_at, first_reply_created_at FROM conversations
           WHERE account_id = $1 AND created_at >= $2 AND first_reply_created_at IS NOT NULL LIMIT 500`,
        [accountId, dayAgo],
      ),
      this.tx.manager.query<{ conversation_id: string }[]>(
        `SELECT conversation_id FROM messages
           WHERE account_id = $1 AND private = false AND created_at >= $2 LIMIT 2000`,
        [accountId, twoHourAgo],
      ),
      this.tx.manager.query<
        { id: string; name: string; status: string; kind: string | null }[]
      >(
        `SELECT p.id, p.name, p.status,
                  (SELECT r.kind FROM agent_roles r WHERE r.persona_id = p.id ORDER BY r.created_at LIMIT 1) AS kind
           FROM agent_personas p
           WHERE p.account_id = $1`,
        [accountId],
      ),
      this.tx.manager.query<
        {
          id: string;
          created_at: string;
          reason: string;
          conversation_id: string;
          from_persona_id: string | null;
          to_persona_id: string | null;
          to_human_user_id: string | null;
        }[]
      >(
        `SELECT id, created_at, reason, conversation_id, from_persona_id, to_persona_id, to_human_user_id
           FROM agent_handoffs WHERE account_id = $1 ORDER BY created_at DESC LIMIT 15`,
        [accountId],
      ),
    ]);

    let open = 0,
      pending = 0,
      snoozed = 0;
    for (const s of statusCounts) {
      if (s.status === 0) open++;
      else if (s.status === 2) pending++;
      else if (s.status === 3) snoozed++;
    }

    let inbound = 0,
      outbound = 0;
    const onDuty = new Set<string>();
    for (const m of msgs) {
      if (m.message_type === 0) inbound++;
      else if (m.message_type === 1) outbound++;
      if (m.sender_type === 'User' && m.sender_id) onDuty.add(m.sender_id);
    }

    let frSumMs = 0;
    for (const r of frRows) {
      frSumMs +=
        new Date(r.first_reply_created_at).getTime() -
        new Date(r.created_at).getTime();
    }
    const avgFirstReplyMin =
      frRows.length > 0
        ? Number((frSumMs / frRows.length / 60_000).toFixed(1))
        : null;

    const counts = new Map<string, number>();
    for (const row of hotConvIds) {
      counts.set(
        row.conversation_id,
        (counts.get(row.conversation_id) ?? 0) + 1,
      );
    }
    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    let hotConversations: HotConversation[] = [];
    if (topIds.length > 0) {
      const convs = await this.tx.manager.query<
        {
          id: string;
          display_id: number;
          status: number;
          priority: number | null;
          last_activity_at: string;
          assignee_id: string | null;
          contact_id: string;
          inbox_id: string;
        }[]
      >(
        `SELECT id, display_id, status, priority, last_activity_at, assignee_id, contact_id, inbox_id
         FROM conversations WHERE id = ANY($1)`,
        [topIds],
      );
      const contactIds = [...new Set(convs.map((c) => c.contact_id))];
      const inboxIds = [...new Set(convs.map((c) => c.inbox_id))];

      const [contactsRes, inboxesRes] = await Promise.all([
        contactIds.length
          ? this.tx.manager.query<{ id: string; name: string | null }[]>(
              `SELECT id, name FROM contacts WHERE id = ANY($1)`,
              [contactIds],
            )
          : Promise.resolve([]),
        inboxIds.length
          ? this.tx.manager.query<{ id: string; name: string | null }[]>(
              `SELECT id, name FROM inboxes WHERE id = ANY($1)`,
              [inboxIds],
            )
          : Promise.resolve([]),
      ]);
      const contactMap = new Map(contactsRes.map((c) => [c.id, c.name]));
      const inboxMap = new Map(inboxesRes.map((i) => [i.id, i.name]));

      hotConversations = convs
        .map((c) => ({
          conversation_id: c.id,
          display_id: c.display_id,
          status: c.status,
          priority: c.priority ?? 0,
          message_count_2h: counts.get(c.id) ?? 0,
          last_activity_at: c.last_activity_at,
          contact_name: contactMap.get(c.contact_id) ?? null,
          inbox_name: inboxMap.get(c.inbox_id) ?? null,
          assignee_id: c.assignee_id,
        }))
        .sort((a, b) => b.message_count_2h - a.message_count_2h);
    }

    const personaMap = new Map(personasRows.map((p) => [p.id, p]));
    const handoffsByPersona = new Map<string, number>();
    for (const h of handoffsHour) {
      if (!h.from_persona_id) continue;
      handoffsByPersona.set(
        h.from_persona_id,
        (handoffsByPersona.get(h.from_persona_id) ?? 0) + 1,
      );
    }
    const msgsByPersona = new Map<string, number>();
    for (const m of msgs) {
      if (m.sender_type === 'AgentBot' && m.sender_id) {
        msgsByPersona.set(
          m.sender_id,
          (msgsByPersona.get(m.sender_id) ?? 0) + 1,
        );
      }
    }
    const personaPulse: PersonaPulse[] = personasRows
      .map((p) => ({
        persona_id: p.id,
        name: p.name,
        kind: p.kind ?? '—',
        status: p.status,
        messages_last_hour: msgsByPersona.get(p.id) ?? 0,
        handoffs_last_hour: handoffsByPersona.get(p.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.messages_last_hour +
          b.handoffs_last_hour -
          (a.messages_last_hour + a.handoffs_last_hour),
      );

    const humanIds = [
      ...new Set(
        recentHandoffsRaw
          .map((h) => h.to_human_user_id)
          .filter((v): v is string => !!v),
      ),
    ];
    const humanMap = new Map<string, string>();
    if (humanIds.length > 0) {
      const humans = await this.tx.manager.query<
        {
          id: string;
          name: string | null;
          display_name: string | null;
          email: string;
        }[]
      >(
        `SELECT id, name, display_name, email FROM profiles WHERE id = ANY($1)`,
        [humanIds],
      );
      for (const u of humans)
        humanMap.set(u.id, u.display_name ?? u.name ?? u.email ?? 'Humano');
    }

    const recentHandoffs: HandoffEvent[] = recentHandoffsRaw.map((h) => ({
      id: h.id,
      created_at: h.created_at,
      reason: h.reason,
      conversation_id: h.conversation_id,
      from_name: h.from_persona_id
        ? (personaMap.get(h.from_persona_id)?.name ?? '—')
        : null,
      to_name: h.to_persona_id
        ? (personaMap.get(h.to_persona_id)?.name ?? '—')
        : h.to_human_user_id
          ? (humanMap.get(h.to_human_user_id) ?? 'Humano')
          : null,
      to_kind: h.to_human_user_id ? 'human' : 'persona',
    }));

    return {
      generated_at: new Date().toISOString(),
      kpis: {
        open_conversations: open,
        pending_conversations: pending,
        snoozed_conversations: snoozed,
        unassigned_open: parseInt(unassignedRows[0]?.count ?? '0', 10),
        messages_last_hour: msgs.length,
        inbound_last_hour: inbound,
        outbound_last_hour: outbound,
        handoffs_last_hour: handoffsHour.length,
        meetings_last_hour: parseInt(meetingsRows[0]?.count ?? '0', 10),
        agents_on_duty: onDuty.size,
        avg_first_reply_min: avgFirstReplyMin,
      },
      hot_conversations: hotConversations,
      recent_handoffs: recentHandoffs,
      persona_pulse: personaPulse,
    };
  }
}
