import { apiClient } from "@/lib/api-client";

export type SdrSnapshot = {
  // Lead funnel
  leads_total: number;
  leads_today: number;
  leads_week: number;

  // Calls
  calls_today: number;
  calls_week: number;
  avg_sentiment_week: number | null; // -1..1
  positive_pct_week: number | null; // 0..100

  // Meetings
  meetings_upcoming: number;
  meetings_attended_week: number;
  meetings_no_show_week: number;
  attendance_rate_week: number | null; // attended / (attended + no_show)

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
  return apiClient.get<SdrSnapshot>(`/accounts/${accountId}/dashboards/sdr-snapshot`);
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
