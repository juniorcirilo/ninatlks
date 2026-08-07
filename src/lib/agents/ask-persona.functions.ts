// Chat genérico para personas registradas em "Agentes de voz" (agent_personas)
// que não têm um Funcionário IA dedicado (Bruno/Ana/Carla). Sem tools —
// conversa apenas com base no system_prompt/first_message cadastrados.

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { getOne } from "@/lib/db";
import { runAgentLoop } from "./runner";

export const askPersona = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({
      accountId: z.string().uuid(),
      personaId: z.string().uuid(),
      userMessage: z.string().min(1).max(2000),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).max(20).default([]),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const persona = await getOne<{ system_prompt: string | null; name: string; llm_model: string; llm_temperature: number }>(
      `SELECT system_prompt, name, llm_model, llm_temperature FROM agent_personas WHERE id = $1 AND account_id = $2`,
      [data.personaId, data.accountId],
    );
    if (!persona) throw new Error("Agente não encontrado");

    const result = await runAgentLoop({
      accountId: data.accountId,
      system: persona.system_prompt || `Você é ${persona.name}, um assistente de atendimento. Responda em português brasileiro de forma clara e objetiva.`,
      history: data.history,
      userMessage: data.userMessage,
      tools: [],
      execute: async () => ({ error: "sem tools disponíveis para este agente" }),
      opts: { model: persona.llm_model, temperature: Number(persona.llm_temperature) },
    });

    return { reply: result.reply, trace: result.trace, personaId: data.personaId, steps: result.steps };
  });
