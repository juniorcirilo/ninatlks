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
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { getOne, query, insert } from "@/lib/db"
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

// ===================== TOOLS =====================

async function execFindContact(accountId: string, args: { phone?: string; email?: string }) {
  let sql = `SELECT id, name, email, phone_number, stage_id, score, briefing FROM contacts WHERE account_id = $1`;
  const params: unknown[] = [accountId];
  if (args.email) {
    sql += ` AND email = $2`;
    params.push(args.email);
  } else if (args.phone) {
    sql += ` AND phone_number = $2`;
    params.push(args.phone);
  } else {
    return { error: "informe phone ou email" };
  }
  sql += ` LIMIT 1`;
  const contact = await getOne(sql, params);
  return { contact };
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
  const keys = Object.keys(payload);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const params = keys.map((k) => (payload as Record<string, any>)[k]);
  const sql = `INSERT INTO contacts (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
    ON CONFLICT (${conflictKey}) DO UPDATE SET ${setClause} RETURNING id, name, phone_number, email`;
  const rows = await query(sql, params);
  return { contact: rows[0] ?? null };
}

async function execSetStage(accountId: string, args: { contact_id: string; stage_name: string }) {
  const stages = await query<{ id: string; pipeline_id: string }>(
    `SELECT ls.id, ls.pipeline_id FROM lead_stages ls
     JOIN lead_pipelines lp ON lp.id = ls.pipeline_id
     WHERE ls.name = $1 AND lp.account_id = $2 LIMIT 1`,
    [args.stage_name, accountId],
  );
  const stage = stages[0];
  if (!stage) return { error: `estágio '${args.stage_name}' não encontrado` };
  await query(
    `UPDATE contacts SET stage_id = $1, stage_changed_at = $2 WHERE id = $3 AND account_id = $4`,
    [stage.id, new Date().toISOString(), args.contact_id, accountId],
  );
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
  const [row] = await insert("scheduled_meetings", {
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
  });
  return { ok: true, meeting_id: row.id, starts_at: row.starts_at };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string; target?: "human" | "persona"; target_persona_id?: string },
) {
  if (!conversationId) return { ok: true, note: "sem conversa ativa — handoff lógico" };
  const [row] = await insert("agent_handoffs", {
    account_id: accountId,
    conversation_id: conversationId,
    from_persona_id: fromPersonaId,
    to_persona_id: args.target === "persona" ? args.target_persona_id ?? null : null,
    reason: args.reason,
    context: { requested_by: "ana", target: args.target ?? "human" },
  });
  return { ok: true, handoff_id: row.id };
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
  .middleware([requireSessionAuth])
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
  const existing = await getOne<{ id: string }>(
    `SELECT id FROM agent_personas WHERE account_id = $1 AND name = $2`,
    [accountId, "Ana"],
  );
  if (existing) return existing.id;

  const [persona] = await insert<{ id: string }>("agent_personas", {
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
  });

  await insert("agent_roles", {
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
  });

  return persona.id;
}
