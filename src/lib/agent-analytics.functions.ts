// Agent Analytics — KPIs por Funcionário IA.
// Calcula em uma única ida ao Postgres: handoffs (saídas), CSAT médio,
// reuniões agendadas (Ana) e total de personas instaladas.
// Janela padrão: últimos 30 dias.

import { apiClient } from "@/lib/api-client";

export interface PersonaKpi {
  persona_id: string;
  name: string;
  kind: string;
  status: string;
  handoffs_out: number; // quantas vezes essa persona pediu handoff
  meetings_scheduled: number; // reuniões originadas por ligações desta persona
  csat_avg: number | null;
  csat_count: number;
  csat_low_pct: number; // % de notas <= 2
  calls_total: number; // ligações de campanha/voz desta persona no período
  calls_completed: number; // ligações atendidas (status completed)
  calls_avg_duration_sec: number; // duração média das ligações atendidas
}

export interface AnalyticsResult {
  window_days: number;
  total_personas: number;
  total_handoffs: number;
  total_meetings: number;
  total_calls: number;
  total_calls_completed: number;
  csat_avg_global: number | null;
  per_persona: PersonaKpi[];
}

export async function getAgentAnalytics(input: {
  accountId: string;
  windowDays?: number;
}): Promise<AnalyticsResult> {
  const params = new URLSearchParams();
  if (input.windowDays) params.set("windowDays", String(input.windowDays));
  const qs = params.toString();
  return apiClient.get<AnalyticsResult>(
    `/accounts/${input.accountId}/dashboards/agent-analytics${qs ? `?${qs}` : ""}`,
  );
}
