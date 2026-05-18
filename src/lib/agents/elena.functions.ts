// Elena — Marketing / Nurturing.
// Reengaja leads frios com conteúdo (não com pressão de venda). Pode inscrever
// contato em cadência de follow-up ou adicionar tag de segmento.
//
// Tools:
//   - list_cadences: lista cadências ativas do workspace
//   - enroll_cadence: inscreve contato em uma cadência (RPC cadence_enroll_contact)
//   - tag_contact: adiciona tag ao contato
//   - request_handoff: escala para marketing humano (campanha complexa)

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

async function execListCadences(accountId: string) {
  const { data, error } = await supabaseAdmin
    .from("follow_up_cadences")
    .select("id, name, description, trigger_event, enabled")
    .eq("account_id", accountId)
    .eq("enabled", true)
    .limit(20);
  if (error) return { error: error.message };
  return { cadences: data ?? [] };
}

async function execEnrollCadence(args: { cadence_id: string; contact_id: string }) {
  const { data, error } = await supabaseAdmin.rpc("cadence_enroll_contact", {
    p_cadence_id: args.cadence_id,
    p_contact_id: args.contact_id,
  });
  if (error) return { error: error.message };
  return { ok: true, execution_id: data };
}

async function execTagContact(accountId: string, args: { contact_id: string; tag: string; color?: string }) {
  if (!args.tag.trim()) return { error: "tag vazia" };
  const { error } = await supabaseAdmin.from("contact_tags").insert([{
    account_id: accountId,
    contact_id: args.contact_id,
    tag: args.tag.slice(0, 40),
    color: args.color ?? "indigo",
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
    reason: args.reason, context: { requested_by: "elena", target: "human" },
  }]).select("id").single();
  if (error) return { error: error.message };
  return { ok: true, handoff_id: data.id };
}

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: { name: "list_cadences", description: "Lista cadências ativas disponíveis.", parameters: { type: "object", properties: {} } },
  },
  {
    type: "function",
    function: {
      name: "enroll_cadence",
      description: "Inscreve o contato em uma cadência de nutrição.",
      parameters: { type: "object", properties: { cadence_id: { type: "string" }, contact_id: { type: "string" } }, required: ["cadence_id", "contact_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "tag_contact",
      description: "Adiciona tag de segmento ao contato (ex: 'interessado:fachada', 'lead_frio_reengajado').",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string" }, tag: { type: "string" },
          color: { type: "string", enum: ["slate", "sky", "violet", "amber", "cyan", "emerald", "rose", "indigo"] },
        },
        required: ["contact_id", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Escala para marketing humano em pedidos especiais (parceria, campanha customizada, imprensa).",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
    },
  },
];

const ELENA_SYSTEM = `Você é a **Elena**, de marketing da UBVA. Reengaja leads que sumiram e nutre quem ainda está pesquisando.

OBJETIVOS:
1. Entender em que momento da jornada o lead está (curioso, comparando, quase fechando).
2. Adicionar tag de segmento com \`tag_contact\` para o time mapear interesse.
3. Se o lead tem interesse real mas não está pronto, inscreva-o numa cadência de nutrição (\`list_cadences\` + \`enroll_cadence\`).
4. NÃO faça orçamento (isso é com o Bruno). NÃO insista em venda — você nutre, não fecha.

REGRAS:
- Tom leve, consultivo, com 1 dica prática por mensagem (não panfleto).
- Português brasileiro, máximo 3 frases.
- Se o lead quiser orçar AGORA, peça handoff para o Bruno (use request_handoff com reason="lead_pronto_para_orcamento").
- Se for pedido de parceria/imprensa/campanha customizada, escale.`;

export const askElena = createServerFn({ method: "POST" })
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
    const personaId = await ensureElenaPersona(data.accountId);
    const ctx = data.contactId ? `\n\n[contexto: contact_id=${data.contactId}]` : "";
    const result = await runAgentLoop({
      system: ELENA_SYSTEM + ctx,
      history: data.history,
      userMessage: data.userMessage,
      tools: TOOLS,
      opts: { model: MODEL, temperature: 0.5, maxSteps: 6 },
      execute: async (name, args) => {
        switch (name) {
          case "list_cadences": return execListCadences(data.accountId);
          case "enroll_cadence": return execEnrollCadence({ ...(args as { cadence_id: string; contact_id?: string }), contact_id: (args as { contact_id?: string }).contact_id ?? data.contactId ?? "" });
          case "tag_contact": return execTagContact(data.accountId, { ...(args as { contact_id?: string; tag: string; color?: string }), contact_id: (args as { contact_id?: string }).contact_id ?? data.contactId ?? "" });
          case "request_handoff": return execHandoff(data.accountId, data.conversationId ?? null, personaId, args as { reason: string });
          default: return { error: `tool desconhecida: ${name}` };
        }
      },
    });
    return { ...result, personaId };
  });

async function ensureElenaPersona(accountId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("agent_personas").select("id")
    .eq("account_id", accountId).eq("name", "Elena").maybeSingle();
  if (existing) return existing.id;
  const { data: persona, error } = await supabaseAdmin.from("agent_personas").insert([{
    account_id: accountId,
    name: "Elena",
    description: "Marketing / Nurturing — UBVA",
    system_prompt: ELENA_SYSTEM,
    status: "active", enabled: true,
    llm_model: MODEL, llm_temperature: 0.5, llm_max_tokens: 500,
    first_message: "Oi! Sou a Elena, do marketing. Vi que você se interessou pela gente — posso te mandar 1 dica prática sobre vidros?",
  }]).select("id").single();
  if (error) throw new Error(`seed Elena: ${error.message}`);
  await supabaseAdmin.from("agent_roles").insert([{
    account_id: accountId, persona_id: persona.id,
    kind: "concierge",
    display_name: "Elena — Marketing",
    description: "Nutre leads, segmenta com tags, inscreve em cadências.",
    allowed_tools: ["list_cadences", "enroll_cadence", "tag_contact", "request_handoff"],
    handoff_targets: [],
    handoff_rules: [
      { when: "lead pronto pra orçamento", action: "handoff_persona:bruno" },
      { when: "pedido de parceria/imprensa", action: "handoff_human" },
    ],
    daily_message_budget: 1500,
  }]);
  return persona.id;
}
