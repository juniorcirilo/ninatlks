// Catálogo de provedores de LLM pros Funcionários IA (texto) + a chamada
// unificada de chat/tool-calling. Seis provedores falam o mesmo formato
// (OpenAI-compatible: /chat/completions, Authorization: Bearer, tools[].function);
// Anthropic tem formato próprio (Messages API) e ganha um adaptador dedicado
// pra não vazar essa diferença pro resto do código (runner.ts, Bruno,
// Supervisor continuam só enxergando o formato OpenAI-shaped).
import type { AgentMessage, ToolDef } from "./runner";

export type ProviderId =
  | "openai"
  | "gemini"
  | "anthropic"
  | "groq"
  | "deepseek"
  | "mistral"
  | "ollama"
  | "lmstudio";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  hint: string;
  /** null = usuário precisa informar (self-hosted, sem endereço padrão útil). */
  defaultBaseUrl: string | null;
  kind: "openai-compatible" | "anthropic";
  requiresApiKey: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { id: "openai", label: "OpenAI", hint: "GPT", defaultBaseUrl: "https://api.openai.com/v1", kind: "openai-compatible", requiresApiKey: true },
  { id: "gemini", label: "Google Gemini", hint: "Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", kind: "openai-compatible", requiresApiKey: true },
  { id: "anthropic", label: "Anthropic", hint: "Claude", defaultBaseUrl: "https://api.anthropic.com", kind: "anthropic", requiresApiKey: true },
  { id: "groq", label: "Groq", hint: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1", kind: "openai-compatible", requiresApiKey: true },
  { id: "deepseek", label: "DeepSeek", hint: "DS", defaultBaseUrl: "https://api.deepseek.com/v1", kind: "openai-compatible", requiresApiKey: true },
  { id: "mistral", label: "Mistral AI", hint: "Mistral", defaultBaseUrl: "https://api.mistral.ai/v1", kind: "openai-compatible", requiresApiKey: true },
  { id: "ollama", label: "Ollama (Local)", hint: "Local", defaultBaseUrl: "http://localhost:11434/v1", kind: "openai-compatible", requiresApiKey: false },
  { id: "lmstudio", label: "LM Studio", hint: "LM Studio", defaultBaseUrl: null, kind: "openai-compatible", requiresApiKey: false },
];

export function providerMeta(id: string): ProviderMeta {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Provedor de IA desconhecido: ${id}`);
  return found;
}

/** Rótulo pra mensagens de erro — tolera "lovable", o pseudo-provedor de fallback que não está em PROVIDERS. */
function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 1024;

export interface ChatCallArgs {
  /** ProviderId real (seletor) ou "lovable" (fallback interno, sempre OpenAI-compatible). */
  provider: ProviderId | "lovable";
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  messages: AgentMessage[];
  tools: ToolDef[];
  /** Só tem efeito nos provedores OpenAI-compatible — Anthropic não tem esse parâmetro. */
  jsonMode?: boolean;
}

export interface ChatCallResult {
  content: string;
  tool_calls: AgentMessage["tool_calls"];
}

export async function callChatCompletion(args: ChatCallArgs): Promise<ChatCallResult> {
  const isAnthropic = args.provider !== "lovable" && providerMeta(args.provider).kind === "anthropic";
  return isAnthropic ? callAnthropic(args) : callOpenAiCompatible(args);
}

async function callOpenAiCompatible(args: ChatCallArgs): Promise<ChatCallResult> {
  const res = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      messages: args.messages,
      ...(args.tools.length > 0 ? { tools: args.tools, tool_choice: "auto" } : {}),
      ...(args.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${providerLabel(args.provider)} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  if (!msg) throw new Error(`Resposta inválida de ${providerLabel(args.provider)}`);
  return { content: msg.content ?? "", tool_calls: msg.tool_calls };
}

// ===================== Anthropic (Messages API) =====================
// Formato diferente em três pontos: (1) auth por x-api-key + header de
// versão, não Bearer; (2) "system" é campo próprio, não uma mensagem role
// "system" dentro do array; (3) tool result volta como mensagem "user" com
// content-block tool_result, não role "tool". Tudo isso fica encapsulado
// aqui — o resto do código só manda/recebe o formato OpenAI-shaped.

interface AnthropicBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

function toAnthropicRequest(args: ChatCallArgs): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string | AnthropicBlock[] }>;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
} {
  const system = args.messages.find((m) => m.role === "system")?.content ?? "";
  const rest = args.messages.filter((m) => m.role !== "system");

  const messages: Array<{ role: "user" | "assistant"; content: string | AnthropicBlock[] }> = [];
  for (const m of rest) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      if (m.tool_calls && m.tool_calls.length > 0) {
        const blocks: AnthropicBlock[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || "{}"); } catch { /* keep empty */ }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        messages.push({ role: "assistant", content: blocks });
      } else {
        messages.push({ role: "assistant", content: m.content ?? "" });
      }
    } else if (m.role === "tool") {
      // Resultado de tool call vira mensagem "user" com um content-block
      // tool_result — junta com o resultado anterior se o último elemento
      // já for uma msg "user" de tool_result (vários resultados no mesmo turno).
      const block: AnthropicBlock = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content ?? "" };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
    }
  }

  const tools = args.tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  return { system, messages, ...(tools.length > 0 ? { tools } : {}) };
}

async function callAnthropic(args: ChatCallArgs): Promise<ChatCallResult> {
  const body = toAnthropicRequest(args);
  const res = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": args.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      temperature: args.temperature,
      system: body.system || undefined,
      messages: body.messages,
      ...(body.tools ? { tools: body.tools } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const blocks: AnthropicBlock[] = Array.isArray(json.content) ? json.content : [];

  const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
  const toolBlocks = blocks.filter((b) => b.type === "tool_use");

  return {
    content: textParts.join("\n"),
    tool_calls: toolBlocks.length > 0
      ? toolBlocks.map((b) => ({
          id: b.id ?? "",
          type: "function" as const,
          function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
        }))
      : undefined,
  };
}
