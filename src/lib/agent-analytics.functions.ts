// Agent Analytics — KPIs por Funcionário IA.
// Calcula em uma única ida ao Postgres: handoffs (saídas), CSAT médio,
// reuniões agendadas (Ana) e total de personas instaladas.
// Janela padrão: últimos 30 dias.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PersonaKpi {
  persona_id: string;
  name: string;
  kind: string;
  status: string;
  handoffs_out: number;       // quantas vezes essa persona pediu handoff
  meetings_scheduled: number; // somente Ana / SDRs
  csat_avg: number | null;
  csat_count: number;
  csat_low_pct: number;       // % de notas <= 2
}

export interface AnalyticsResult {
  window_days: number;
  total_personas: number;
  total_handoffs: number;
  total_meetings: number;
  csat_avg_global: number | null;
  per_persona: PersonaKpi[];
}

export const getAgentAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      windowDays: z.number().int().min(1).max(365).default(30),
    }).parse(d),
  )
  .handler(async ({ data }): Promise<AnalyticsResult> => {
    const since = new Date(Date.now() - data.windowDays * 86400_000).toISOString();

    const [personasRes, handoffsRes, meetingsRes, csatRes] = await Promise.all([
      supabaseAdmin
        .from("agent_personas")
        .select("id, name, status, agent_roles(kind)")
        .eq("account_id", data.accountId),
      supabaseAdmin
        .from("agent_handoffs")
        .select("from_persona_id")
        .eq("account_id", data.accountId)
        .gte("created_at", since),
      supabaseAdmin
        .from("scheduled_meetings")
        .select("id, created_at")
        .eq("account_id", data.accountId)
        .gte("created_at", since),
      supabaseAdmin
        .from("csat_surveys")
        .select("rating, handler_type, handler_id")
        .eq("account_id", data.accountId)
        .gte("sent_at", since)
        .not("rating", "is", null),
    ]);

    const personas = (personasRes.data ?? []) as Array<{
      id: string; name: string; status: string;
      agent_roles: Array<{ kind: string }> | null;
    }>;

    const handoffsByPersona = new Map<string, number>();
    for (const h of handoffsRes.data ?? []) {
      const pid = (h as { from_persona_id: string | null }).from_persona_id;
      if (!pid) continue;
      handoffsByPersona.set(pid, (handoffsByPersona.get(pid) ?? 0) + 1);
    }

    const csatByPersona = new Map<string, number[]>();
    let csatGlobalSum = 0;
    let csatGlobalN = 0;
    for (const c of csatRes.data ?? []) {
      const row = c as { rating: number; handler_type: string | null; handler_id: string | null };
      csatGlobalSum += row.rating;
      csatGlobalN += 1;
      if (row.handler_id) {
        const arr = csatByPersona.get(row.handler_id) ?? [];
        arr.push(row.rating);
        csatByPersona.set(row.handler_id, arr);
      }
    }

    const meetingsTotal = (meetingsRes.data ?? []).length;
    // Heurística: atribuímos reuniões à(s) persona(s) SDR ativa(s).
    const sdrPersonas = personas.filter((p) => (p.agent_roles ?? []).some((r) => r.kind === "sdr"));
    const meetingsPerSdr = sdrPersonas.length > 0 ? Math.round(meetingsTotal / sdrPersonas.length) : 0;

    const perPersona: PersonaKpi[] = personas.map((p) => {
      const ratings = csatByPersona.get(p.id) ?? [];
      const sum = ratings.reduce((a, b) => a + b, 0);
      const isSdr = (p.agent_roles ?? []).some((r) => r.kind === "sdr");
      return {
        persona_id: p.id,
        name: p.name,
        kind: p.agent_roles?.[0]?.kind ?? "—",
        status: p.status,
        handoffs_out: handoffsByPersona.get(p.id) ?? 0,
        meetings_scheduled: isSdr ? meetingsPerSdr : 0,
        csat_avg: ratings.length > 0 ? Number((sum / ratings.length).toFixed(2)) : null,
        csat_count: ratings.length,
        csat_low_pct: ratings.length > 0
          ? Number(((ratings.filter((r) => r <= 2).length / ratings.length) * 100).toFixed(1))
          : 0,
      };
    });

    return {
      window_days: data.windowDays,
      total_personas: personas.length,
      total_handoffs: handoffsRes.data?.length ?? 0,
      total_meetings: meetingsTotal,
      csat_avg_global: csatGlobalN > 0 ? Number((csatGlobalSum / csatGlobalN).toFixed(2)) : null,
      per_persona: perPersona.sort((a, b) => (b.handoffs_out + b.csat_count) - (a.handoffs_out + a.csat_count)),
    };
  });
