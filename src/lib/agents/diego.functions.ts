// Diego — Cobrança / Financeiro.
// Negocia recebimento de orçamentos aprovados não pagos. Não dá desconto sem
// passar por humano; só registra promessa de pagamento ou escala.
//
// Tools:
//   - lookup_pending: contas em aberto do contato (contact_facts c/ chave "debt:*")
//   - log_promise: registra promessa de pagamento (conversation_outcomes)
//   - request_handoff: escala para financeiro humano

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

async function execLookupPending(accountId: string, args: { contact_id: string }) {
  const { data, error } = await supabaseAdmin
    .from("contact_facts")
    .select("key, value, confidence")
    .eq("account_id", accountId)
    .eq("contact_id", args.contact_id)
    .like("key", "debt:%")
    .limit(10);
  if (error) return { error: error.message };
  return { pending: data ?? [] };
}

async function execLogPromise(
  accountId: string,
  conversationId: string | null,
  args: { amount: number; due_date: string; method?: string; notes?: string },
) {
  if (!conversationId) return { ok: true, note: "promessa lógica" };
  if (args.amount <= 0) return { error: "valor inválido" };
  const { error } = await supabaseAdmin.from("conversation_outcomes").insert([{
    account_id: accountId,
    conversation_id: conversationId,
    outcome_type: "cobranca:promessa_pagamento",
    value: args.amount,
    currency: "BRL",
    source: "diego",
    metadata: { due_date: args.due_date, method: args.method ?? null, notes: args.notes ?? null } as never,
  }]);
  if (error) return { error: error.message };
  return { ok: true };
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
    reason: args.reason, context: { requested_by: "diego", target: "human" },
  }]).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, handoff_id: data.id };
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "lookup_pending",
      description: "Lista contas em aberto do contato (chave debt:*).",
      parameters: { type: "object", properties: { contact_id: { type: "string" } }, required: ["contact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "log_promise",
      description: "Registra promessa de pagamento (valor, data, método). Use SOMENTE depois que o cliente confirmou explicitamente.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "number", description: "Valor em BRL" },
          due_date: { type: "string", description: "ISO date (YYYY-MM-DD)" },
          method: { type: "string", enum: ["pix", "boleto", "cartao", "dinheiro", "transferencia"] },
          notes: { type: "string" },
        },
        required: ["amount", "due_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Escala para financeiro humano. Use quando: cliente pede desconto, contesta valor, ameaça processo, ou diz que não tem como pagar.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
];

const DIEGO_SYSTEM = `Você é o **Diego**, do financeiro da UBVA. Negocia o recebimento de orçamentos aprovados em atraso.

OBJETIVOS:
1. Confirmar identidade ("posso confirmar seu nome?") antes de falar valores.
2. Usar \`lookup_pending\` para ver o que está em aberto.
3. Negociar UMA data e UM método de pagamento. Registrar com \`log_promise\`.
4. JAMAIS conceder desconto, parcelamento extra ou prazo > 30 dias por conta própria — escale com \`request_handoff\`.

REGRAS:
- Tom cordial, firme, NUNCA agressivo. Você cobra, não persegue.
- Português brasileiro, máximo 3 frases por mensagem.
- Se cliente disser que já pagou: registre como reason "cliente_alega_pagamento" e escale.
- Se cliente ficar irritado, ameaçar ou pedir Procon, escale imediatamente.
- Respeite Lei do Consumidor: nunca cobre na frente de terceiros, nunca cause constrangimento.`;

export const askDiego = createServerFn({ method: "POST" })
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
    const personaId = await ensureDiegoPersona(data.accountId);
    const ctx = data.contactId ? `\n\n[contexto: contact_id=${data.contactId}]` : "";
    const result = await runAgentLoop({
      system: DIEGO_SYSTEM + ctx,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.3, maxSteps: 6 },
      execute: async (name, args) => {
        switch (name) {
          case "lookup_pending": return execLookupPending(data.accountId, args as { contact_id: string });
          case "log_promise": return execLogPromise(data.accountId, data.conversationId ?? null, args as Parameters<typeof execLogPromise>[2]);
          case "request_handoff": return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as { reason: string });
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });
    return { ...result, personaId };
  });

async function ensureDiegoPersona(accountId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("agent_personas").select("id")
    .eq("account_id", accountId).eq("name", "Diego").maybeSingle();
  if (existing) return existing.id;
  const { data: persona, error } = await supabaseAdmin.from("agent_personas").insert([{
    account_id: accountId,
    name: "Diego",
    description: "Cobrança / Financeiro — UBVA",
    system_prompt: DIEGO_SYSTEM,
    status: "active", enabled: true,
    llm_model: MODEL, llm_temperature: 0.3, llm_max_tokens: 500,
    first_message: "Olá! Sou o Diego, do financeiro da UBVA. Posso confirmar seu nome para falarmos sobre seu orçamento?",
  }]).select("id").single();
  if (error) throw new Error(`seed Diego: ${error.message}`);
  await supabaseAdmin.from("agent_roles").insert([{
    account_id: accountId, persona_id: persona.id,
    kind: "cobranca",
    display_name: "Diego — Cobrança",
    description: "Negocia recebimento; escala desconto/contestação para humano.",
    allowed_tools: ["lookup_pending", "log_promise", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "cliente pede desconto", action: "handoff_human" },
      { when: "cliente contesta valor", action: "handoff_human" },
      { when: "ameaça procon/processo", action: "handoff_human" },
    ],
    daily_message_budget: 800,
  }]);
  return persona.id;
}
