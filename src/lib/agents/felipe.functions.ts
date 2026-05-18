// Felipe — Logística / Agendamento de entrega e instalação.
// Combina data de entrega ou instalação, registra em scheduled_meetings com
// tipo "delivery". Não orçamenta, não cobra.
//
// Tools:
//   - propose_delivery_slots: 3 datas úteis a partir de amanhã às 9h/14h
//   - schedule_delivery: cria scheduled_meetings com title "Entrega/Instalação"
//   - request_handoff: escala para logística humana

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

function proposeSlots(): Array<{ starts_at: string; period: string }> {
  const out: Array<{ starts_at: string; period: string }> = [];
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (out.length < 3) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      const morning = new Date(d); morning.setHours(9, 0, 0, 0);
      const afternoon = new Date(d); afternoon.setHours(14, 0, 0, 0);
      out.push({ starts_at: morning.toISOString(), period: "manhã (9h)" });
      if (out.length < 3) out.push({ starts_at: afternoon.toISOString(), period: "tarde (14h)" });
    }
    d.setDate(d.getDate() + 1);
  }
  return out.slice(0, 3);
}

async function execScheduleDelivery(
  accountId: string,
  args: {
    contact_id?: string;
    invitee_name?: string;
    invitee_phone?: string;
    address?: string;
    starts_at: string;
    kind: "entrega" | "instalacao";
  },
) {
  const start = new Date(args.starts_at);
  if (Number.isNaN(start.getTime())) return { error: "data inválida" };
  const ends = new Date(start.getTime() + 90 * 60_000);
  const title = args.kind === "instalacao" ? "Instalação no cliente" : "Entrega de vidro";
  const { data, error } = await supabaseAdmin.from("scheduled_meetings").insert([{
    account_id: accountId,
    contact_id: args.contact_id ?? null,
    title,
    starts_at: start.toISOString(),
    ends_at: ends.toISOString(),
    duration_minutes: 90,
    status: "scheduled",
    provider: "manual",
    provider_event_id: `felipe-${crypto.randomUUID()}`,
    invitee_name: args.invitee_name ?? null,
    invitee_phone: args.invitee_phone ?? null,
    briefing: { kind: args.kind, address: args.address ?? null, source: "felipe" } as never,
  }]).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, meeting_id: data.id, when: start.toISOString(), kind: args.kind };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string },
) {
  if (!conversationId) return { ok: true, note: "handoff lógico" };
  const { data, error } = await supabaseAdmin.from("agent_handoffs").insert([{
    account_id: accountId, conversation_id: conversationId, from_persona_id: fromPersonaId,
    reason: args.reason, context: { requested_by: "felipe", target: "human" },
  }]).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, handoff_id: data.id };
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: { name: "propose_delivery_slots", description: "Sugere 3 janelas úteis (manhã/tarde) começando amanhã.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: {
      name: "schedule_delivery",
      description: "Agenda entrega ou instalação. kind=entrega (cliente retira ou recebe) ou instalacao (equipe vai ao local).",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          invitee_name: { type: "string" },
          invitee_phone: { type: "string" },
          address: { type: "string" },
          starts_at: { type: "string", description: "ISO datetime, ex: 2026-05-20T13:00:00Z" },
          kind: { type: "string", enum: ["entrega", "instalacao"] },
        },
        required: ["starts_at", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Escala para logística humana em: endereço fora da área, urgência (<24h), carga especial (>3m²), ou cliente pede reagendamento múltiplo.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
];

const FELIPE_SYSTEM = `Você é o **Felipe**, da logística da UBVA. Combina datas de entrega e instalação de vidros.

OBJETIVOS:
1. Confirmar endereço E telefone de contato no local antes de qualquer agendamento.
2. Diferenciar entrega (cliente recebe ou retira) de instalação (equipe técnica vai ao local).
3. Oferecer 3 janelas com \`propose_delivery_slots\`, deixar o cliente escolher uma, e confirmar com \`schedule_delivery\`.

REGRAS:
- Janela padrão: dias úteis, 9h ou 14h. Duração 90min (instalação é mais longa, mas reservamos 90min por segurança).
- Para urgência (<24h) OU carga grande (>3m²), escale com \`request_handoff\`.
- Português brasileiro, máximo 3 frases. NÃO orçamente, NÃO cobre — isso é com Bruno/Diego.
- Sempre confirme: data, período, endereço, nome de quem vai receber.`;

export const askFelipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      userMessage: z.string().min(1).max(2000),
      conversationId: z.string().uuid().optional(),
      contactId: z.string().uuid().optional(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const personaId = await ensureFelipePersona(data.accountId);
    const ctx = data.contactId ? `\n\n[contexto: contact_id=${data.contactId}]` : "";
    const result = await runAgentLoop({
      system: FELIPE_SYSTEM + ctx,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.3, maxSteps: 6 },
      execute: async (name, args) => {
        switch (name) {
          case "propose_delivery_slots": return { slots: proposeSlots() };
          case "schedule_delivery": return execScheduleDelivery(data.accountId, { ...(args as Parameters<typeof execScheduleDelivery>[1]), contact_id: (args as { contact_id?: string }).contact_id ?? data.contactId });
          case "request_handoff": return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as { reason: string });
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });
    return { ...result, personaId };
  });

async function ensureFelipePersona(accountId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("agent_personas").select("id")
    .eq("account_id", accountId).eq("name", "Felipe").maybeSingle();
  if (existing) return existing.id;
  const { data: persona, error } = await supabaseAdmin.from("agent_personas").insert([{
    account_id: accountId,
    name: "Felipe",
    description: "Logística / Entrega / Instalação — UBVA",
    system_prompt: FELIPE_SYSTEM,
    status: "active", enabled: true,
    llm_model: MODEL, llm_temperature: 0.3, llm_max_tokens: 500,
    first_message: "Olá! Sou o Felipe, da logística. Vamos combinar a entrega ou instalação? Me confirma o endereço, por favor.",
  }]).select("id").single();
  if (error) throw new Error(`seed Felipe: ${error.message}`);
  await supabaseAdmin.from("agent_roles").insert([{
    account_id: accountId, persona_id: persona.id,
    kind: "concierge",
    display_name: "Felipe — Logística",
    description: "Agenda entrega e instalação; escala urgências e cargas especiais.",
    allowed_tools: ["propose_delivery_slots", "schedule_delivery", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "urgência <24h", action: "handoff_human" },
      { when: "carga >3m²", action: "handoff_human" },
    ],
    daily_message_budget: 1000,
  }]);
  return persona.id;
}
