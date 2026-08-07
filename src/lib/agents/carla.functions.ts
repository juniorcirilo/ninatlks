// Carla — Pós-venda / Customer Success.
// Acompanha reuniões realizadas, coleta CSAT, identifica risco de churn,
// encaminha para humano em casos críticos.
//
// Tools:
//   - find_recent_meeting: busca reunião realizada/agendada do contato
//   - log_csat: grava avaliação em csat_surveys
//   - log_outcome: registra resultado em conversation_outcomes
//   - request_handoff: passa para humano de CS

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, insert } from "@/lib/db";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

async function execFindMeeting(accountId: string, args: { contact_id: string }) {
  const data = await query(
    `SELECT id, title, starts_at, status, attended_at
     FROM scheduled_meetings
     WHERE account_id = $1 AND contact_id = $2
     ORDER BY starts_at DESC LIMIT 3`,
    [accountId, args.contact_id],
  );
  return { meetings: data };
}

async function execLogCsat(
  accountId: string,
  conversationId: string | null,
  args: { contact_id?: string; score: number; comment?: string },
) {
  if (args.score < 1 || args.score > 5) return { error: "score deve estar entre 1 e 5" };
  if (!conversationId) {
    return { ok: true, note: "csat lógico (sem conversation_id)", risk: args.score <= 2 ? "high" : args.score === 3 ? "medium" : "low" };
  }
  try {
    const [row] = await insert<{ id: string }>("csat_surveys", {
      account_id: accountId,
      contact_id: args.contact_id ?? null,
      conversation_id: conversationId,
      rating: args.score,
      feedback: args.comment ?? null,
      handler_type: "agent",
      status: "answered",
      answered_at: new Date().toISOString(),
    });
    return { ok: true, survey_id: row.id, risk: args.score <= 2 ? "high" : args.score === 3 ? "medium" : "low" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function execLogOutcome(
  accountId: string,
  conversationId: string | null,
  args: { outcome: string; notes?: string },
) {
  if (!conversationId) return { ok: true, note: "sem conversa ativa" };
  try {
    await insert("conversation_outcomes", {
      account_id: accountId,
      conversation_id: conversationId,
      outcome_type: args.outcome.slice(0, 40),
      source: "carla",
      metadata: { notes: args.notes ?? null },
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string },
) {
  if (!conversationId) return { ok: true, note: "sem conversa ativa — handoff lógico" };
  try {
    const [row] = await insert<{ id: string }>("agent_handoffs", {
      account_id: accountId,
      conversation_id: conversationId,
      from_persona_id: fromPersonaId,
      reason: args.reason,
      context: { requested_by: "carla", target: "human" },
    });
    return { ok: true, handoff_id: row.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "find_recent_meeting",
      description: "Lista as últimas reuniões do contato (até 3) para entender contexto antes de coletar feedback.",
      parameters: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "log_csat",
      description: "Grava nota de satisfação (1-5) com comentário opcional. Retorna nível de risco.",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          score: { type: "number", description: "1 a 5" },
          comment: { type: "string" },
          channel: { type: "string", enum: ["chat", "whatsapp", "voice", "email"] },
        },
        required: ["score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "log_outcome",
      description: "Registra o desfecho da conversa (ex: 'feedback_positivo', 'queixa_produto', 'pedido_devolucao').",
      parameters: {
        type: "object",
        properties: { outcome: { type: "string" }, notes: { type: "string" } },
        required: ["outcome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Aciona humano de CS quando: CSAT ≤ 2, cliente irritado, pedido de cancelamento, ou problema fora do roteiro.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
];

const CARLA_SYSTEM = `Você é a **Carla**, do time de Pós-venda / Customer Success. Atende clientes que já compraram ou já passaram por reunião.

OBJETIVOS:
1. Confirmar como foi a experiência (reunião, produto, atendimento).
2. Coletar nota CSAT de 1 a 5 com \`log_csat\`. Sempre pergunte de forma natural ("De 1 a 5, como você avalia...").
3. Registrar o desfecho com \`log_outcome\` (palavras-chave: feedback_positivo, queixa_produto, pedido_devolucao, sucesso, neutro).
4. Se a nota for ≤ 2 OU o cliente reclamar/cancelar/ficar irritado, chame \`request_handoff\` imediatamente.

REGRAS:
- Tom empático e curto. Nunca minimize a frustração do cliente.
- Se tiver contact_id, comece com \`find_recent_meeting\` pra mostrar contexto ("vi que você teve reunião dia X, como foi?").
- Não force venda. Não ofereça desconto. Foque em escutar.
- Português brasileiro, máximo 3 frases por mensagem.`;

export const askCarla = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
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
    const personaId = await ensureCarlaPersona(data.accountId);
    const ctxNote = data.contactId ? `\n\n[contexto: contact_id=${data.contactId}]` : "";

    const result = await runAgentLoop({
      accountId: data.accountId,
      system: CARLA_SYSTEM + ctxNote,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.4, maxSteps: 6 },
      execute: async (name, args) => {
        switch (name) {
          case "find_recent_meeting": return execFindMeeting(data.accountId, args as { contact_id: string });
          case "log_csat": return execLogCsat(data.accountId, data.conversationId ?? null, { ...(args as { score: number; comment?: string }), contact_id: (args as { contact_id?: string }).contact_id ?? data.contactId });
          case "log_outcome": return execLogOutcome(data.accountId, data.conversationId ?? null, args as { outcome: string; notes?: string });
          case "request_handoff": return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as { reason: string });
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });

    return { ...result, personaId };
  });

async function ensureCarlaPersona(accountId: string): Promise<string> {
  const found = await query<{ id: string }>(
    `SELECT id FROM agent_personas WHERE account_id = $1 AND name = $2`,
    [accountId, "Carla"],
  );
  if (found.length > 0) return found[0].id;

  const [persona] = await insert<{ id: string }>("agent_personas", {
    account_id: accountId,
    name: "Carla",
    description: "Customer Success — CSAT e retenção",
    system_prompt: CARLA_SYSTEM,
    status: "active",
    enabled: true,
    llm_model: MODEL,
    llm_temperature: 0.4,
    llm_max_tokens: 500,
    first_message: "Oi! Aqui é a Carla, do pós-venda. Posso te perguntar como foi sua última experiência?",
  });

  await insert("agent_roles", {
    account_id: accountId,
    persona_id: persona.id,
    kind: "suporte",
    display_name: "Carla — Pós-venda",
    description: "Coleta CSAT, identifica risco de churn e escala para humano em casos críticos.",
    allowed_tools: ["find_recent_meeting", "log_csat", "log_outcome", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "CSAT <= 2", action: "handoff_human" },
      { when: "pedido_devolucao", action: "handoff_human" },
    ],
    daily_message_budget: 1500,
  });

  return persona.id;
}
