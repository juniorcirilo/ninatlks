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
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { query, getOne, insert } from "@/lib/db";
import { runAgentLoop, type ToolDef } from "./runner";

const MODEL = "google/gemini-2.5-flash";

async function execListCadences(accountId: string) {
  const cadences = await query(
    `SELECT id, name, description, trigger_event, enabled FROM follow_up_cadences WHERE account_id = $1 AND enabled = true LIMIT 20`,
    [accountId],
  );
  return { cadences };
}

async function execEnrollCadence(args: { cadence_id: string; contact_id: string }) {
  const result = await query(
    `SELECT * FROM cadence_enroll_contact($1, $2)`,
    [args.contact_id, args.cadence_id],
  );
  return { ok: true, execution_id: result[0] };
}

async function execTagContact(accountId: string, args: { contact_id: string; tag: string; color?: string }) {
  if (!args.tag.trim()) return { error: "tag vazia" };
  const rows = await insert("contact_tags", {
    account_id: accountId,
    contact_id: args.contact_id,
    tag: args.tag.slice(0, 40),
    color: args.color ?? "indigo",
  });
  return { ok: true };
}

async function execHandoff(
  accountId: string,
  conversationId: string | null,
  fromPersonaId: string | null,
  args: { reason: string },
) {
  if (!conversationId) return { ok: true, note: "handoff lógico" };
  const rows = await insert("agent_handoffs", {
    account_id: accountId,
    conversation_id: conversationId,
    from_persona_id: fromPersonaId,
    reason: args.reason,
    context: { requested_by: "elena", target: "human" },
  });
  return { ok: true, handoff_id: rows[0]?.id };
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
      description: "Adiciona uma tag de segmento ao contato.",
      parameters: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          tag: { type: "string" },
          color: { type: "string" },
        },
        required: ["contact_id", "tag"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_handoff",
      description: "Escala para humano de marketing.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
];

// ensureElenaPersona removed — persona creation is handled by the onboarding wizard.

export const elenaAgent = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      conversationId: z.string().uuid().nullable(),
      fromPersonaId: z.string().uuid().nullable(),
      contactId: z.string().uuid(),
      messages: z.array(z.object({ role: z.string(), content: z.string() })).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const result = await runAgentLoop({
      model: MODEL,
      system: `Você é a Elena, especialista em marketing e nurturing. Seu papel é reengajar leads frios com conteúdo relevante, nunca com pressão de venda. Responda em português do Brasil de forma acolhedora e profissional.`,
      tools: TOOLS,
      toolExecutors: {
        list_cadences: () => execListCadences(data.accountId),
        enroll_cadence: (args) => execEnrollCadence(args),
        tag_contact: (args) => execTagContact(data.accountId, args),
        request_handoff: (args) => execHandoff(data.accountId, data.conversationId, data.fromPersonaId, args),
      },
    });
    return result;
  });
