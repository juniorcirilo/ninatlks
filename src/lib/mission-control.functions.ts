// Mission Control — cockpit executivo em tempo real.
// Agrega o estado vivo da operação omnichannel + Funcionários IA:
//  - conversas abertas / pendentes / snoozed
//  - volume de mensagens, handoffs e reuniões na última hora
//  - top conversas "quentes" (mais mensagens nas últimas 2h)
//  - stream recente de handoffs (quem passou pra quem, e por quê)
//  - escala humana on-duty (agentes que enviaram mensagem nas últimas 15 min)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
  to_kind: "persona" | "human";
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

export const getMissionControlSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ accountId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }): Promise<MissionControlSnapshot> => {
    const now = Date.now();
    const hourAgo = new Date(now - 3600_000).toISOString();
    const twoHourAgo = new Date(now - 2 * 3600_000).toISOString();
    const fifteenMinAgo = new Date(now - 15 * 60_000).toISOString();
    const dayAgo = new Date(now - 24 * 3600_000).toISOString();

    const [
      convCountsRes,
      unassignedRes,
      messagesRes,
      handoffsRes,
      meetingsRes,
      firstReplyRes,
      hotConvIdsRes,
      personasRes,
      recentHandoffsRes,
    ] = await Promise.all([
      supabaseAdmin
        .from("conversations")
        .select("status", { count: "exact" })
        .eq("account_id", data.accountId)
        .in("status", [0, 2, 3]),
      supabaseAdmin
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", data.accountId)
        .eq("status", 0)
        .is("assignee_id", null),
      supabaseAdmin
        .from("messages")
        .select("message_type, sender_type, sender_id, created_at")
        .eq("account_id", data.accountId)
        .eq("private", false)
        .gte("created_at", hourAgo),
      supabaseAdmin
        .from("agent_handoffs")
        .select("from_persona_id")
        .eq("account_id", data.accountId)
        .gte("created_at", hourAgo),
      supabaseAdmin
        .from("scheduled_meetings")
        .select("id", { count: "exact", head: true })
        .eq("account_id", data.accountId)
        .gte("created_at", hourAgo),
      supabaseAdmin
        .from("conversations")
        .select("created_at, first_reply_created_at")
        .eq("account_id", data.accountId)
        .gte("created_at", dayAgo)
        .not("first_reply_created_at", "is", null)
        .limit(500),
      supabaseAdmin
        .from("messages")
        .select("conversation_id")
        .eq("account_id", data.accountId)
        .eq("private", false)
        .gte("created_at", twoHourAgo)
        .limit(2000),
      supabaseAdmin
        .from("agent_personas")
        .select("id, name, status, agent_roles(kind)")
        .eq("account_id", data.accountId),
      supabaseAdmin
        .from("agent_handoffs")
        .select("id, created_at, reason, conversation_id, from_persona_id, to_persona_id, to_human_user_id")
        .eq("account_id", data.accountId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);

    // Conversation status counts
    const statuses = (convCountsRes.data ?? []) as Array<{ status: number }>;
    let open = 0, pending = 0, snoozed = 0;
    for (const s of statuses) {
      if (s.status === 0) open += 1;
      else if (s.status === 2) pending += 1;
      else if (s.status === 3) snoozed += 1;
    }

    // Messages breakdown
    const msgs = (messagesRes.data ?? []) as Array<{
      message_type: number; sender_type: string | null; sender_id: string | null;
    }>;
    let inbound = 0, outbound = 0;
    const onDuty = new Set<string>();
    for (const m of msgs) {
      if (m.message_type === 0) inbound += 1;
      else if (m.message_type === 1) outbound += 1;
      if (m.sender_type === "User" && m.sender_id) onDuty.add(m.sender_id);
    }

    // First reply average (in minutes)
    const fr = (firstReplyRes.data ?? []) as Array<{ created_at: string; first_reply_created_at: string }>;
    let frSumMs = 0;
    for (const r of fr) {
      frSumMs += new Date(r.first_reply_created_at).getTime() - new Date(r.created_at).getTime();
    }
    const avgFirstReplyMin = fr.length > 0 ? Number((frSumMs / fr.length / 60_000).toFixed(1)) : null;

    // Hot conversations — count messages per conv in last 2h
    const counts = new Map<string, number>();
    for (const row of hotConvIdsRes.data ?? []) {
      const cid = (row as { conversation_id: string }).conversation_id;
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    let hotConversations: HotConversation[] = [];
    if (topIds.length > 0) {
      const { data: convs } = await supabaseAdmin
        .from("conversations")
        .select("id, display_id, status, priority, last_activity_at, assignee_id, contact_id, inbox_id")
        .in("id", topIds);

      const convsList = (convs ?? []) as Array<{
        id: string; display_id: number; status: number; priority: number | null;
        last_activity_at: string; assignee_id: string | null;
        contact_id: string; inbox_id: string;
      }>;

      const contactIds = [...new Set(convsList.map((c) => c.contact_id))];
      const inboxIds = [...new Set(convsList.map((c) => c.inbox_id))];

      const [contactsRes, inboxesRes] = await Promise.all([
        contactIds.length > 0
          ? supabaseAdmin.from("contacts").select("id, name").in("id", contactIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
        inboxIds.length > 0
          ? supabaseAdmin.from("inboxes").select("id, name").in("id", inboxIds)
          : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }> }),
      ]);
      const contactMap = new Map((contactsRes.data ?? []).map((c) => [c.id, c.name]));
      const inboxMap = new Map((inboxesRes.data ?? []).map((i) => [i.id, i.name]));

      hotConversations = convsList
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

    // Personas + handoff events
    const personasList = (personasRes.data ?? []) as Array<{
      id: string; name: string; status: string;
      agent_roles: Array<{ kind: string }> | null;
    }>;
    const personaMap = new Map(personasList.map((p) => [p.id, p]));

    const handoffsHour = (handoffsRes.data ?? []) as Array<{ from_persona_id: string | null }>;
    const handoffsByPersona = new Map<string, number>();
    for (const h of handoffsHour) {
      if (!h.from_persona_id) continue;
      handoffsByPersona.set(h.from_persona_id, (handoffsByPersona.get(h.from_persona_id) ?? 0) + 1);
    }

    // Messages per persona (last hour) — heurística: sender_type "AgentBot" + sender_id ~ persona_id
    const msgsByPersona = new Map<string, number>();
    for (const m of msgs) {
      if (m.sender_type === "AgentBot" && m.sender_id) {
        msgsByPersona.set(m.sender_id, (msgsByPersona.get(m.sender_id) ?? 0) + 1);
      }
    }

    const personaPulse: PersonaPulse[] = personasList.map((p) => ({
      persona_id: p.id,
      name: p.name,
      kind: p.agent_roles?.[0]?.kind ?? "—",
      status: p.status,
      messages_last_hour: msgsByPersona.get(p.id) ?? 0,
      handoffs_last_hour: handoffsByPersona.get(p.id) ?? 0,
    })).sort((a, b) => (b.messages_last_hour + b.handoffs_last_hour) - (a.messages_last_hour + a.handoffs_last_hour));

    // Recent handoffs feed
    const recentRaw = (recentHandoffsRes.data ?? []) as Array<{
      id: string; created_at: string; reason: string; conversation_id: string;
      from_persona_id: string | null; to_persona_id: string | null; to_human_user_id: string | null;
    }>;

    const humanIds = [...new Set(recentRaw.map((h) => h.to_human_user_id).filter(Boolean) as string[])];
    let humanMap = new Map<string, string>();
    if (humanIds.length > 0) {
      const { data: humans } = await supabaseAdmin
        .from("profiles")
        .select("id, name, display_name, email")
        .in("id", humanIds);
      humanMap = new Map((humans ?? []).map((u) => [
        u.id as string,
        ((u.display_name as string | null) ?? (u.name as string | null) ?? (u.email as string | null) ?? "Humano"),
      ]));
    }

    const recentHandoffs: HandoffEvent[] = recentRaw.map((h) => ({
      id: h.id,
      created_at: h.created_at,
      reason: h.reason,
      conversation_id: h.conversation_id,
      from_name: h.from_persona_id ? personaMap.get(h.from_persona_id)?.name ?? "—" : null,
      to_name: h.to_persona_id
        ? personaMap.get(h.to_persona_id)?.name ?? "—"
        : h.to_human_user_id ? humanMap.get(h.to_human_user_id) ?? "Humano" : null,
      to_kind: h.to_human_user_id ? "human" : "persona",
    }));

    return {
      generated_at: new Date().toISOString(),
      kpis: {
        open_conversations: open,
        pending_conversations: pending,
        snoozed_conversations: snoozed,
        unassigned_open: unassignedRes.count ?? 0,
        messages_last_hour: msgs.length,
        inbound_last_hour: inbound,
        outbound_last_hour: outbound,
        handoffs_last_hour: handoffsHour.length,
        meetings_last_hour: meetingsRes.count ?? 0,
        agents_on_duty: onDuty.size,
        avg_first_reply_min: avgFirstReplyMin,
      },
      hot_conversations: hotConversations,
      recent_handoffs: recentHandoffs,
      persona_pulse: personaPulse,
    };
  });
