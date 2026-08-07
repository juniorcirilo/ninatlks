// Runner genérico de tool-calling. Usa o provedor de IA configurado pela
// conta (Configurações → Integrações → Provedor de IA do Agente — OpenAI,
// Gemini, Anthropic, Groq, DeepSeek, Mistral, Ollama ou LM Studio; cai pra IA
// própria legada e depois pro Lovable — ver resolveLlmConfig). O formato
// específico de cada provedor (Anthropic é diferente do resto) fica isolado
// em providers.ts; aqui só se enxerga mensagens/tool_calls no formato
// OpenAI-shaped. Compartilhado por Ana, Carla, Felipe, Clara, Diego e o
// Playground (ask-persona).

import { resolveLlmConfig } from "./llm-config";
import { callChatCompletion, type ChatCallResult } from "./providers";

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface RunnerOpts {
  model?: string;
  temperature?: number;
  maxSteps?: number;
}

export interface RunnerResult {
  reply: string;
  steps: number;
  trace: Array<{ tool: string; args: string; result: string }>;
}

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export async function runAgentLoop(params: {
  accountId: string;
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  tools: ToolDef[];
  execute: ToolExecutor;
  opts?: RunnerOpts;
}): Promise<RunnerResult> {
  const llm = await resolveLlmConfig(params.accountId, params.opts?.model);
  const temperature = params.opts?.temperature ?? 0.4;
  const maxSteps = params.opts?.maxSteps ?? 6;

  const messages: AgentMessage[] = [
    { role: "system", content: params.system },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];

  const trace: RunnerResult["trace"] = [];

  for (let step = 0; step < maxSteps; step++) {
    let msg: ChatCallResult;
    try {
      msg = await callChatCompletion({
        provider: llm.provider,
        baseUrl: llm.baseUrl,
        apiKey: llm.apiKey,
        model: llm.model,
        temperature,
        messages,
        tools: params.tools,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (llm.provider === "lovable") {
        if (message.includes(" 429:")) throw new Error("Limite de uso do gateway atingido. Tente novamente em instantes.");
        if (message.includes(" 402:")) throw new Error("Créditos do Lovable AI esgotados. Adicione créditos em Configurações.");
      }
      throw err;
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: msg.content ?? "", steps: step + 1, trace };
    }

    messages.push({ role: "assistant", content: msg.content || null, tool_calls: msg.tool_calls });

    const results = await Promise.all(
      msg.tool_calls.map(async (tc: NonNullable<AgentMessage["tool_calls"]>[number]) => {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
        let result: unknown;
        try {
          result = await params.execute(tc.function.name, parsed);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        trace.push({ tool: tc.function.name, args: JSON.stringify(parsed), result: JSON.stringify(result) });
        return { tc, result };
      }),
    );

    for (const { tc, result } of results) {
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(result),
      });
    }
  }

  return { reply: "(limite de passos atingido sem resposta final)", steps: maxSteps, trace };
}
