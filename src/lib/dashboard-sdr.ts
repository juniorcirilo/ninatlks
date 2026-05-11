import { supabase } from "@/integrations/supabase/client";

export type SdrSnapshot = {
  // Lead funnel
  leads_total: number;
  leads_today: number;
  leads_week: number;

  // Calls
  calls_today: number;
  calls_week: number;
  avg_sentiment_week: number | null;     // -1..1
  positive_pct_week: number | null;      // 0..100

  // Meetings
  meetings_upcoming: number;
  meetings_attended_week: number;
  meetings_no_show_week: number;
  attendance_rate_week: number | null;   // attended / (attended + no_show)

  // Funnel snapshot
  pipeline: {
    stage_id: string;
    stage_name: string;
    color: string;
    count: number;
    is_won: boolean;
    is_lost: boolean;
  }[];

  // Próximas reuniões (top 3)
  upcoming_meetings: {
    id: string;
    starts_at: string;
    invitee_name: string | null;
    invitee_phone: string | null;
    attendee_name: string | null;
    confirmed: boolean;
  }[];
};

export async function fetchSdrSnapshot(accountId: string): Promise<SdrSnapshot> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const horizon7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Resiliente: se uma query falhar (RLS, tabela faltando), retorna fallback em vez de
  // derrubar o painel inteiro.
  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
    p.then((v) => v).catch((e) => {
      console.warn("[dashboard-sdr] query failed", e);
      return fallback;
    });
  const zeroCount = { count: 0 } as { count: number | null };
  const emptyData = { data: [] as any[] };

  const [
    { count: leadsTotal },
    { count: leadsToday },
    { count: leadsWeek },
    { count: callsToday },
    { count: callsWeek },
    { data: callsSentiment },
    { count: meetingsUpcoming },
    { count: meetingsAttendedWeek },
    { count: meetingsNoShowWeek },
    pipelineData,
    upcomingData,
  ] = await Promise.all([
    safe(sb()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId), zeroCount),
    safe(sb()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", startOfDay.toISOString()), zeroCount),
    safe(sb()
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", weekAgo.toISOString()), zeroCount),
    safe(sb()
      .from("voice_calls")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("started_at", startOfDay.toISOString()), zeroCount),
    safe(sb()
      .from("voice_calls")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("started_at", weekAgo.toISOString()), zeroCount),
    safe(sb()
      .from("voice_calls")
      .select("sentiment")
      .eq("account_id", accountId)
      .gte("started_at", weekAgo.toISOString())
      .not("sentiment", "is", null)
      .limit(500), emptyData),
    safe(sb()
      .from("scheduled_meetings")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "scheduled")
      .gte("starts_at", now.toISOString())
      .lt("starts_at", horizon7d.toISOString()), zeroCount),
    safe(sb()
      .from("scheduled_meetings")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "attended")
      .gte("attended_at", weekAgo.toISOString()), zeroCount),
    safe(sb()
      .from("scheduled_meetings")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "no_show")
      .gte("detected_no_show_at", weekAgo.toISOString()), zeroCount),
    safe(fetchPipelineSnapshot(accountId), [] as any[]),
    safe(fetchUpcomingMeetings(accountId), [] as any[]),
  ]);

  // Sentiment aggregates
  let avgSentiment: number | null = null;
  let positivePct: number | null = null;
  const sentRows = (callsSentiment ?? []) as Array<{ sentiment: any }>;
  if (sentRows.length > 0) {
    const scores = sentRows
      .map((r) => Number(r.sentiment?.score ?? 0))
      .filter((n) => !Number.isNaN(n));
    if (scores.length > 0) {
      avgSentiment = scores.reduce((s, n) => s + n, 0) / scores.length;
      const positives = sentRows.filter((r) => r.sentiment?.aggregate === "positive").length;
      positivePct = (positives / sentRows.length) * 100;
    }
  }

  const attended = meetingsAttendedWeek ?? 0;
  const noShow = meetingsNoShowWeek ?? 0;
  const attendanceRate =
    attended + noShow > 0 ? (attended / (attended + noShow)) * 100 : null;

  return {
    leads_total: leadsTotal ?? 0,
    leads_today: leadsToday ?? 0,
    leads_week: leadsWeek ?? 0,
    calls_today: callsToday ?? 0,
    calls_week: callsWeek ?? 0,
    avg_sentiment_week: avgSentiment,
    positive_pct_week: positivePct,
    meetings_upcoming: meetingsUpcoming ?? 0,
    meetings_attended_week: attended,
    meetings_no_show_week: noShow,
    attendance_rate_week: attendanceRate,
    pipeline: pipelineData,
    upcoming_meetings: upcomingData,
  };
}

async function fetchPipelineSnapshot(accountId: string) {
  const { data } = await (supabase as any).rpc("pipeline_get", {
    p_account_id: accountId,
  });
  if (!data) return [];
  const stages = (data as any).stages ?? [];
  return stages.map((s: any) => ({
    stage_id: s.id,
    stage_name: s.name,
    color: s.color,
    count: Array.isArray(s.leads) ? s.leads.length : 0,
    is_won: !!s.is_won,
    is_lost: !!s.is_lost,
  }));
}

async function fetchUpcomingMeetings(accountId: string) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { data } = await sb()
    .from("scheduled_meetings")
    .select("id, starts_at, invitee_name, invitee_phone, attendee_user_id, confirmed_at")
    .eq("account_id", accountId)
    .eq("status", "scheduled")
    .gte("starts_at", now.toISOString())
    .lt("starts_at", horizon.toISOString())
    .order("starts_at")
    .limit(3);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // Resolve attendee names (small batch)
  const userIds = Array.from(new Set(rows.map((r) => r.attendee_user_id).filter(Boolean)));
  const profiles: Record<string, string | null> = {};
  if (userIds.length > 0) {
    const { data: profs } = await sb()
      .from("profiles")
      .select("id, display_name, name, email")
      .in("id", userIds);
    for (const p of (profs ?? []) as any[]) {
      profiles[p.id] = p.display_name ?? p.name ?? p.email ?? null;
    }
  }

  return rows.map((r) => ({
    id: r.id,
    starts_at: r.starts_at,
    invitee_name: r.invitee_name,
    invitee_phone: r.invitee_phone,
    attendee_name: r.attendee_user_id ? profiles[r.attendee_user_id] ?? null : null,
    confirmed: !!r.confirmed_at,
  }));
}

function sb(): any {
  return supabase as any;
}

export function formatSentiment(score: number | null): string {
  if (score == null) return "—";
  if (score > 0.15) return "Positivo";
  if (score < -0.15) return "Negativo";
  return "Neutro";
}

export function sentimentTone(score: number | null): string {
  if (score == null) return "text-slate-400";
  if (score > 0.15) return "text-emerald-300";
  if (score < -0.15) return "text-rose-300";
  return "text-slate-300";
}
