// Cross-channel unified timeline por contato (Fase 2 — Omnichannel+).
//
// Junta numa única linha do tempo:
//   - mensagens de todas as conversations do contato (qualquer canal)
//   - chamadas de voz (voice_calls)
//   - reuniões agendadas (scheduled_meetings)
//   - tomadas de controle humano (live_takeovers)
//
// Cada item carrega o canal de origem para o frontend renderizar com ícone
// correto e permitir filtro por canal/tipo.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TimelineKind = "message" | "call" | "meeting" | "takeover";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  channel: string; // 'whatsapp' | 'instagram' | 'voice' | 'email' | 'system'...
  at: string;
  title: string;
  preview: string | null;
  conversationId: string | null;
  meta: Record<string, string | number | boolean | null>;
}

export interface ContactTimeline {
  contact: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  conversations: Array<{
    id: string;
    inboxName: string | null;
    channelType: string | null;
    status: number;
    lastActivityAt: string;
    messageCount: number;
  }>;
  items: TimelineItem[];
}

export const getContactTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ contactId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ContactTimeline> => {
    const { supabase } = context;
    const { contactId } = data;

    const { data: contact, error: cErr } = await supabase
      .from("contacts")
      .select("id, name, email, phone_number")
      .eq("id", contactId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!contact) throw new Error("Contato não encontrado");

    const [convsRes, callsRes, meetingsRes, takeoversRes] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, inbox_id, status, last_activity_at, inboxes(name, channel_type)")
        .eq("contact_id", contactId)
        .order("last_activity_at", { ascending: false })
        .limit(50),
      supabase
        .from("voice_calls")
        .select("id, direction, status, duration_seconds, from_number, to_number, conversation_id, started_at, created_at")
        .or(`from_number.eq.${contact.phone_number ?? "__none__"},to_number.eq.${contact.phone_number ?? "__none__"}`)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("scheduled_meetings")
        .select("id, title, starts_at, status, meeting_url, provider")
        .eq("contact_id", contactId)
        .order("starts_at", { ascending: false })
        .limit(20),
    ]);

    if (convsRes.error) throw new Error(convsRes.error.message);
    const conversations = (convsRes.data ?? []) as Array<Record<string, unknown>>;
    const convIds = conversations.map((c) => c.id as string);

    // Buscar mensagens das conversations encontradas (cap 200 mais recentes).
    let messages: Array<Record<string, unknown>> = [];
    if (convIds.length > 0) {
      const { data: msgs, error: mErr } = await supabase
        .from("messages")
        .select("id, conversation_id, content, message_type, sender_type, private, created_at, content_attributes")
        .in("conversation_id", convIds)
        .eq("private", false)
        .order("created_at", { ascending: false })
        .limit(200);
      if (mErr) throw new Error(mErr.message);
      messages = msgs ?? [];
    }

    const convChannel = new Map<string, { channelType: string | null; name: string | null }>();
    for (const c of conversations) {
      const inbox = (c.inboxes as { name?: string; channel_type?: string } | null) ?? null;
      convChannel.set(c.id as string, {
        channelType: inbox?.channel_type ?? null,
        name: inbox?.name ?? null,
      });
    }

    const items: TimelineItem[] = [];

    for (const m of messages) {
      const cid = m.conversation_id as string;
      const ch = convChannel.get(cid);
      items.push({
        id: `msg-${m.id}`,
        kind: "message",
        channel: ch?.channelType ?? "system",
        at: m.created_at as string,
        title: m.sender_type === "Contact" ? "Mensagem recebida" : "Mensagem enviada",
        preview: ((m.content as string | null) ?? "").slice(0, 220),
        conversationId: cid,
        meta: { messageType: m.message_type, senderType: m.sender_type },
      });
    }

    for (const v of (callsRes.data ?? []) as Array<Record<string, unknown>>) {
      const ts = (v.started_at ?? v.created_at) as string;
      items.push({
        id: `call-${v.id}`,
        kind: "call",
        channel: "voice",
        at: ts,
        title: `Chamada ${v.direction === "outbound" ? "feita" : "recebida"} · ${v.status}`,
        preview: `${v.duration_seconds ?? 0}s · ${v.from_number} → ${v.to_number}`,
        conversationId: (v.conversation_id as string) ?? null,
        meta: { duration: v.duration_seconds, status: v.status },
      });
    }

    for (const mt of (meetingsRes.data ?? []) as Array<Record<string, unknown>>) {
      items.push({
        id: `meet-${mt.id}`,
        kind: "meeting",
        channel: "system",
        at: mt.starts_at as string,
        title: `Reunião · ${mt.status}`,
        preview: (mt.title as string) ?? null,
        conversationId: null,
        meta: { url: mt.meeting_url, provider: mt.provider },
      });
    }

    for (const t of (takeoversRes.data ?? []) as Array<Record<string, unknown>>) {
      if (!convIds.includes(t.conversation_id as string)) continue;
      items.push({
        id: `tk-${t.id}`,
        kind: "takeover",
        channel: convChannel.get(t.conversation_id as string)?.channelType ?? "system",
        at: t.started_at as string,
        title: t.ended_at ? "Atendimento humano encerrado" : "Atendimento humano iniciado",
        preview: (t.reason as string | null) ?? null,
        conversationId: t.conversation_id as string,
        meta: {},
      });
    }

    items.sort((a, b) => (b.at > a.at ? 1 : -1));

    const msgCountByConv = new Map<string, number>();
    for (const m of messages) {
      const cid = m.conversation_id as string;
      msgCountByConv.set(cid, (msgCountByConv.get(cid) ?? 0) + 1);
    }

    return {
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        phone: contact.phone_number,
      },
      conversations: conversations.map((c) => {
        const inbox = (c.inboxes as { name?: string; channel_type?: string } | null) ?? null;
        return {
          id: c.id as string,
          inboxName: inbox?.name ?? null,
          channelType: inbox?.channel_type ?? null,
          status: c.status as number,
          lastActivityAt: c.last_activity_at as string,
          messageCount: msgCountByConv.get(c.id as string) ?? 0,
        };
      }),
      items: items.slice(0, 300),
    };
  });
