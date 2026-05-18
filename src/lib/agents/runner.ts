// Runner genérico para loop de tool-calling OpenAI-compatible contra
// o Lovable AI Gateway. Compartilhado por Bruno, Ana, Carla e futuras personas.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
  system: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  tools: ToolDef[];
  execute: ToolExecutor;
  opts?: RunnerOpts;
}): Promise<RunnerResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY não configurado");

  const model = params.opts?.model ?? "google/gemini-2.5-flash";
  const temperature = params.opts?.temperature ?? 0.4;
  const maxSteps = params.opts?.maxSteps ?? 6;

  const messages: AgentMessage[] = [
    { role: "system", content: params.system },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];

  const trace: RunnerResult["trace"] = [];

  for (let step = 0; step < maxSteps; step++) {
    const res = await fetch(GATEWAY, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature,
        messages,
        tools: params.tools,
        tool_choice: "auto",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Limite de uso do gateway atingido. Tente novamente em instantes.");
      if (res.status === 402) throw new Error("Créditos do Lovable AI esgotados. Adicione créditos em Configurações.");
      throw new Error(`Gateway ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error("Resposta inválida do gateway");

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { reply: (msg.content as string) ?? "", steps: step + 1, trace };
    }

    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });

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
