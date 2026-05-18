// Ana — SDR (Sales Development Representative).
// Qualifica leads, atualiza estágio no pipeline, propõe e agenda reuniões.
//
// Tools:
//   - find_contact: busca contato por telefone/email
//   - upsert_contact: cria ou atualiza contato + briefing
//   - set_pipeline_stage: move contato no funil (lead_stages)
//   - propose_meeting: gera 3 slots a partir da disponibilidade do account
//   - schedule_meeting: grava em scheduled_meetings
//   - request_handoff: passa para humano de vendas

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

// ===================== TOOLS =====================

async function execFindContact(accountId: string, args: { phone?: string; email?: string }) {
  let q = supabaseAdmin
    .from("contacts")
    .select("id, name, email, phone_number, stage_id, score, briefing")
    .eq("account_id", accountId)
    .limit(1);
  if (args.email) q = q.eq("email", args.email);
  else if (args.phone) q = q.eq("phone_number", args.phone);
  else return { error: "informe phone ou email" };
  const { data, error } = await q.maybeSingle();
  if (error) return { error: error.message };
  return { contact: data };
}

async function execUpsertContact(
  accountId: string,
  args: { name?: string; phone?: string; email?: string; briefing?: Record<string, unknown> },
) {
  if (!args.phone && !args.email) return { error: "informe phone ou email" };
  const payload = {
    account_id: accountId,
    name: args.name ?? null,
    phone_number: args.phone ?? null,
    email: args.email ?? null,
    briefing: (args.briefing ?? null) as never,
    source: "ana_sdr",
  };
  // tenta upsert por email se existir; senão por phone_number.
  const conflictKey = args.email ? "account_id,email" : "account_id,phone_number";
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .upsert([payload], { onConflict: conflictKey })
    .select("id, name, phone_number, email")
    .single();
  if (error) return { error: error.message };
  return { contact: data };
}

async function execSetStage(accountId: string, args: { contact_id: string; stage_name: string }) {
  const { data: stage, error: e1 } = await supabaseAdmin
    .from("lead_stages")
    .select("id, pipeline_id, lead_pipelines!inner(account_id)")
    .eq("name", args.stage_name)
    .eq("lead_pipelines.account_id", accountId)
    .maybeSingle();
  if (e1 || !stage) return { error: `estágio '${args.stage_name}' não encontrado` };
  const { error: e2 } = await supabaseAdmin
    .from("contacts")
    .update({ stage_id: stage.id, stage_changed_at: new Date().toISOString() })
    .eq("id", args.contact_id)
    .eq("account_id", accountId);
  if (e2) return { error: e2.message };
  return { ok: true, stage_id: stage.id };
}

function next3Slots(base: Date): string[] {
  // Heurística simples: próximos 3 dias úteis às 10h (timezone do servidor).
  const slots: string[] = [];
  const d = new Date(base);
  while (slots.length < 3) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const s = new Date(d);
    s.setHours(10, 0, 0, 0);
    slots.push(s.toISOString());
  }
  return slots;
}

async function execProposeMeeting() {
  return { slots_iso: next3Slots(new Date()) };
}

async function execScheduleMeeting(
  accountId: string,
  args: { contact_id: string; starts_at: string; duration_minutes?: number; title?: string; modality?: string },
) {
  const ends = new Date(new Date(args.starts_at).getTime() + (args.duration_minutes ?? 30) * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("scheduled_meetings")
    .insert([{
      account_id: accountId,
      contact_id: args.contact_id,
      provider: "internal",
      provider_event_id: `ana-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      starts_at: args.starts_at,
      ends_at: ends,
      title: args.title ?? "Reunião com Ana (SDR)",
      modality: args.modality ?? "online",
      duration_minutes: args.duration_minutes ?? 30,
      status: "scheduled",
    }])
    .select("id, starts_at")
    .single();
  if (error) return { error: error.message };
  return { ok: true, meeting_id: data.id, starts_at: data.starts_at };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string; target?: "human" | "persona"; target_persona_id?: string },
) {
  if (!conversationId) return { ok: true, note: "sem conversa ativa — handoff lógico" };
  const { data, error } = await supabaseAdmin
    .from("agent_handoffs")
    .insert([{
      account_id: accountId,
      conversation_id: conversationId,
      from_persona_id: fromPersonaId,
      to_persona_id: args.target === "persona" ? args.target_persona_id ?? null : null,
      reason: args.reason,
      context: { requested_by: "ana", target: args.target ?? "human" },
    }])
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { ok: true, handoff_id: data.id };
}

// ===================== SCHEMAS =====================

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "find_contact",
      description: "Procura contato existente no workspace por telefone (E.164) ou email.",
      parameters: {
        type: "object",
        properties: { phone: { type: "string" }, email: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "upsert_contact",
      description: "Cria ou atualiza contato com nome, telefone, email e briefing (objeto JSON com dor, orçamento, urgência, etc).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          briefing: { type: "object", description: "ex: { pain, budget, urgency, decision_maker }" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_pipeline_stage",
      description: "Move o contato para um estágio do funil pelo nome (ex: 'Qualificado', 'Reunião marcada').",
      parameters: {
        type: "object",
        properties: { contact_id: { type: "string" }, stage_name: { type: "string" } },
        required: ["contact_id", "stage_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_meeting",
      description: "Retorna 3 horários disponíveis (próximos dias úteis às 10h) para sugerir ao cliente.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_meeting",
      description: "Agenda a reunião escolhida pelo cliente em scheduled_meetings.",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          starts_at: { type: "string", description: "ISO 8601" },
          duration_minutes: { type: "number" },
          title: { type: "string" },
          modality: { type: "string", enum: ["online", "presencial", "telefone"] },
        },
        required: ["contact_id", "starts_at"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Passa a conversa para humano de vendas quando o lead é high-ticket, técnico ou pede pessoa.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          target: { type: "string", enum: ["human", "persona"] },
          target_persona_id: { type: "string" },
        },
        required: ["reason"],
      },
    },
  },
];

const ANA_SYSTEM = `Você é a **Ana**, SDR (qualificação de leads). Conversa em português brasileiro, tom consultivo e direto, sem ser invasiva.

OBJETIVOS, em ordem:
1. Descobrir o contexto do lead: dor/problema, urgência, orçamento aproximado, se ele decide ou indica outra pessoa.
2. Registrar o lead com \`upsert_contact\` (sempre que tiver pelo menos telefone OU email + nome).
3. Atualizar o estágio com \`set_pipeline_stage\` (ex: "Qualificado", "Reunião marcada").
4. Ao identificar fit + interesse, ofereça reunião: chame \`propose_meeting\` e mostre os 3 horários em formato humano (ex: "amanhã 10h", "quinta 10h").
5. Quando o cliente aceitar, chame \`schedule_meeting\`.
6. Se o lead pedir desconto agressivo, demonstração técnica profunda, ou disser explicitamente "quero falar com humano", chame \`request_handoff\` com target="human".

REGRAS:
- Faça UMA pergunta por vez. Não despeje formulário.
- Sempre que coletar 2-3 dados novos, salve com \`upsert_contact\` (passe briefing como objeto JSON).
- Nunca invente nome ou empresa do cliente.
- Não prometa preço final; encaminhe para o Bruno (orçamentista) se for sobre valores complexos.
- Respostas curtas (máximo 3-4 frases) salvo quando estiver listando horários ou resumindo.`;

// ===================== SERVER FN =====================

export const askAna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      userMessage: z.string().min(1).max(2000),
      conversationId: z.string().uuid().optional(),
      history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const personaId = await ensureAnaPersona(data.accountId);

    const result = await runAgentLoop({
      system: ANA_SYSTEM,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.5, maxSteps: 8 },
      execute: async (name, args) => {
        switch (name) {
          case "find_contact": return execFindContact(data.accountId, args as { phone?: string; email?: string });
          case "upsert_contact": return execUpsertContact(data.accountId, args as Parameters<typeof execUpsertContact>[1]);
          case "set_pipeline_stage": return execSetStage(data.accountId, args as { contact_id: string; stage_name: string });
          case "propose_meeting": return execProposeMeeting();
          case "schedule_meeting": return execScheduleMeeting(data.accountId, args as Parameters<typeof execScheduleMeeting>[1]);
          case "request_handoff":
            return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as Parameters<typeof execHandoff>[3]);
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });

    return { ...result, personaId };
  });

// ===================== PERSONA SEEDER =====================

async function ensureAnaPersona(accountId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("agent_personas")
    .select("id")
    .eq("account_id", accountId)
    .eq("name", "Ana")
    .maybeSingle();
  if (existing) return existing.id;

  const { data: persona, error } = await supabaseAdmin
    .from("agent_personas")
    .insert([{
      account_id: accountId,
      name: "Ana",
      description: "SDR — qualifica leads e marca reuniões",
      system_prompt: ANA_SYSTEM,
      status: "active",
      enabled: true,
      llm_model: MODEL,
      llm_temperature: 0.5,
      llm_max_tokens: 600,
      first_message: "Oi! Sou a Ana. Posso te fazer 2 perguntinhas pra entender o que você precisa?",
    }])
    .select("id")
    .single();
  if (error) throw new Error(`seed persona Ana: ${error.message}`);

  await supabaseAdmin.from("agent_roles").insert([{
    account_id: accountId,
    persona_id: persona.id,
    kind: "sdr",
    display_name: "Ana — SDR",
    description: "Qualifica leads, atualiza pipeline e agenda reuniões.",
    allowed_tools: ["find_contact", "upsert_contact", "set_pipeline_stage", "propose_meeting", "schedule_meeting", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "lead high-ticket", action: "handoff_human" },
      { when: "demo técnica profunda", action: "handoff_human" },
    ],
    daily_message_budget: 2000,
  }]);

  return persona.id;
}
