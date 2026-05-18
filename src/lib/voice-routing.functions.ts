// Roteamento inbound de chamadas (Fase 2D — Voicebot 24/7 com fallback humano).
//
// Decide, em tempo real, se uma chamada entrante deve:
//   - tocar no voicebot (IA) imediatamente; ou
//   - entrar em fila para humano (se horário comercial + agente disponível); ou
//   - tocar voicebot com handoff automático pra humano em N segundos.
//
// Usado pelo handler do Twilio incoming (twilio-incoming Edge Function) e
// também pelo painel admin pra simular o roteamento ("dry run").

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RouteDecision = "bot" | "human_queue" | "bot_then_human";

export interface RoutingResult {
  decision: RouteDecision;
  reason: string;
  inboxId: string | null;
  personaId: string | null;
  insideBusinessHours: boolean;
  humansOnline: number;
}

interface WorkingHoursConfig {
  enabled?: boolean;
  // 0=Dom, 6=Sáb; ranges em HH:MM no timezone do inbox
  schedule?: Array<{ day: number; open: string; close: string }>;
}

function isInsideWindow(now: Date, tz: string, schedule: WorkingHoursConfig["schedule"]): boolean {
  if (!schedule || schedule.length === 0) return true;
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz || "America/Sao_Paulo" }));
  const day = local.getDay();
  const minutes = local.getHours() * 60 + local.getMinutes();
  for (const s of schedule) {
    if (s.day !== day) continue;
    const [oh, om] = s.open.split(":").map(Number);
    const [ch, cm] = s.close.split(":").map(Number);
    const o = oh * 60 + om;
    const c = ch * 60 + cm;
    if (minutes >= o && minutes <= c) return true;
  }
  return false;
}

async function decide(phoneNumberId: string): Promise<RoutingResult> {
  // Inbox associado ao número Twilio.
  const { data: pn } = await supabaseAdmin
    .from("phone_numbers")
    .select("id, account_id, inbox_id, inboxes(id, timezone, working_hours_enabled, auto_assignment_config)")
    .eq("id", phoneNumberId)
    .maybeSingle();

  if (!pn) {
    return {
      decision: "bot",
      reason: "phone_number não encontrado — fallback para bot",
      inboxId: null,
      personaId: null,
      insideBusinessHours: false,
      humansOnline: 0,
    };
  }

  const inbox = (pn as { inboxes?: {
    id: string;
    timezone: string | null;
    working_hours_enabled: boolean;
    auto_assignment_config: WorkingHoursConfig | null;
  } | null }).inboxes ?? null;
  const inboxId = inbox?.id ?? (pn as { inbox_id?: string }).inbox_id ?? null;
  const accountId = (pn as { account_id: string }).account_id;

  // Persona ativa do inbox.
  const { data: deployment } = await supabaseAdmin
    .from("agent_persona_deployments")
    .select("persona_id")
    .eq("inbox_id", inboxId ?? "")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  const personaId = (deployment as { persona_id?: string } | null)?.persona_id ?? null;

  // Horário comercial.
  const insideBH = inbox?.working_hours_enabled
    ? isInsideWindow(
        new Date(),
        inbox.timezone ?? "America/Sao_Paulo",
        inbox.auto_assignment_config?.schedule ?? [],
      )
    : true; // se não habilitado, considera sempre dentro

  // Humanos disponíveis no account. Sem presence/heartbeat ainda — usamos o
  // count de membros como proxy "tem time pra atender". Fase 3 adiciona
  // presence real via WebSocket.
  const { count: humansOnline } = await supabaseAdmin
    .from("account_users")
    .select("user_id", { count: "exact", head: true })
    .eq("account_id", accountId);

  const humans = humansOnline ?? 0;

  if (insideBH && humans > 0) {
    return {
      decision: "bot_then_human",
      reason: `horário comercial + ${humans} humano(s) online — bot atende e oferece transferência`,
      inboxId,
      personaId,
      insideBusinessHours: insideBH,
      humansOnline: humans,
    };
  }
  if (!insideBH && !personaId) {
    return {
      decision: "human_queue",
      reason: "fora do horário e sem persona configurada — deixar mensagem pra humano",
      inboxId,
      personaId: null,
      insideBusinessHours: insideBH,
      humansOnline: humans,
    };
  }
  return {
    decision: "bot",
    reason: insideBH
      ? "sem humanos online — bot atende 24/7"
      : "fora do horário comercial — bot atende",
    inboxId,
    personaId,
    insideBusinessHours: insideBH,
    humansOnline: humans,
  };
}

export const routeInboundCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ phoneNumberId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<RoutingResult> => {
    return decide(data.phoneNumberId);
  });

// Reusável internamente (sem auth) por edge functions.
export { decide as decideInboundCallRouting };
