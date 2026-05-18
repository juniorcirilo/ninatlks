// Clara — Suporte Técnico de Vidros.
// Atende clientes com vidro já instalado: defeitos, dúvidas de uso, garantia,
// solicitação de visita técnica. Não vende, não orçamenta — só diagnostica.
//
// Tools:
//   - lookup_history: últimas conversas/orçamentos do contato
//   - log_issue: registra ocorrência (conversation_outcomes)
//   - request_handoff: escala para técnico humano

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

async function execLookupHistory(accountId: string, args: { contact_id: string }) {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id, created_at, status, last_activity_at")
    .eq("account_id", accountId)
    .eq("contact_id", args.contact_id)
    .order("last_activity_at", { ascending: false })
    .limit(5);
  if (error) return { error: error.message };
  return { conversations: data ?? [] };
}

async function execLogIssue(
  accountId: string,
  conversationId: string | null,
  args: { issue_type: string; severity: "baixa" | "media" | "alta" | "critica"; notes?: string },
) {
  if (!conversationId) return { ok: true, note: "log lógico — sem conversation_id" };
  const { error } = await supabaseAdmin.from("conversation_outcomes").insert([{
    account_id: accountId,
    conversation_id: conversationId,
    outcome_type: `suporte:${args.issue_type}`.slice(0, 40),
    source: "clara",
    metadata: { severity: args.severity, notes: args.notes ?? null } as never,
  }]);
  if (error) return { error: error.message };
  return { ok: true, escalate_human: args.severity === "alta" || args.severity === "critica" };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string },
) {
  if (!conversationId) return { ok: true, note: "handoff lógico" };
  const { data, error } = await supabaseAdmin.from("agent_handoffs").insert([{
    account_id: accountId,
    conversation_id: conversationId,
    from_persona_id: fromPersonaId,
    reason: args.reason,
    context: { requested_by: "clara", target: "human" },
  }]).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, handoff_id: data.id };
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "lookup_history",
      description: "Últimas 5 conversas do contato — para entender contexto da reclamação.",
      parameters: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "log_issue",
      description: "Registra ocorrência técnica. Severidade: baixa (dúvida), media (defeito estético), alta (defeito funcional), critica (risco de segurança / vidro trincando).",
      parameters: {
        type: "object",
        properties: {
          issue_type: { type: "string", description: "ex: trinca, infiltracao, ruido, instalacao_torta, garantia" },
          severity: { type: "string", enum: ["baixa", "media", "alta", "critica"] },
          notes: { type: "string" },
        },
        required: ["issue_type", "severity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Aciona técnico humano. Use SEMPRE em severidade alta/critica, suspeita de quebra iminente, ou queixa de garantia.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
];

const CLARA_SYSTEM = `Você é a **Clara**, do suporte técnico da UBVA. Atende clientes com vidro JÁ INSTALADO.

OBJETIVOS:
1. Diagnosticar o problema em até 3 perguntas curtas (o que aconteceu? quando? está colocando risco?).
2. Classificar severidade e chamar \`log_issue\`.
3. Se severidade for "alta" ou "critica", chame \`request_handoff\` IMEDIATAMENTE — vidro trincado, infiltração ativa ou risco de queda é prioridade absoluta.

REGRAS:
- Tom calmo e profissional, nunca minimize.
- NÃO faça orçamento (isso é com o Bruno). NÃO ofereça desconto.
- Se cliente quiser orçar troca/reparo, peça handoff humano (Bruno entra depois).
- Português brasileiro, máximo 3 frases por mensagem.
- Em risco de segurança (vidro caindo, trinca crescendo), oriente o cliente a se afastar e isolar a área ANTES de qualquer outra coisa.`;

export const askClara = createServerFn({ method: "POST" })
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
    const personaId = await ensureClaraPersona(data.accountId);
    const ctx = data.contactId ? `\n\n[contexto: contact_id=${data.contactId}]` : "";
    const result = await runAgentLoop({
      system: CLARA_SYSTEM + ctx,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.3, maxSteps: 6 },
      execute: async (name, args) => {
        switch (name) {
          case "lookup_history": return execLookupHistory(data.accountId, args as { contact_id: string });
          case "log_issue": return execLogIssue(data.accountId, data.conversationId ?? null, args as Parameters<typeof execLogIssue>[2]);
          case "request_handoff": return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as { reason: string });
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });
    return { ...result, personaId };
  });

async function ensureClaraPersona(accountId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("agent_personas").select("id")
    .eq("account_id", accountId).eq("name", "Clara").maybeSingle();
  if (existing) return existing.id;
  const { data: persona, error } = await supabaseAdmin.from("agent_personas").insert([{
    account_id: accountId,
    name: "Clara",
    description: "Suporte técnico de vidros — UBVA",
    system_prompt: CLARA_SYSTEM,
    status: "active", enabled: true,
    llm_model: MODEL, llm_temperature: 0.3, llm_max_tokens: 500,
    first_message: "Oi, aqui é a Clara do suporte técnico. Me conta o que está acontecendo com o vidro?",
  }]).select("id").single();
  if (error) throw new Error(`seed Clara: ${error.message}`);
  await supabaseAdmin.from("agent_roles").insert([{
    account_id: accountId, persona_id: persona.id,
    kind: "suporte",
    display_name: "Clara — Suporte Técnico",
    description: "Diagnostica defeitos pós-instalação e escala para técnico humano.",
    allowed_tools: ["lookup_history", "log_issue", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "severidade alta ou critica", action: "handoff_human" },
      { when: "garantia", action: "handoff_human" },
    ],
    daily_message_budget: 800,
  }]);
  return persona.id;
}
