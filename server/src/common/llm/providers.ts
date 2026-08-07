// Porta de src/lib/agents/providers.ts (lado TanStack/Node) para o NestJS —
// mesmo catálogo de provedores e mesma chamada dual-format (OpenAI-compatible
// vs Anthropic Messages API), sem a parte de tool-calling (o auto-reply de
// WhatsApp só faz chat simples, sem function-calling).

export type ProviderId =
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'ollama'
  | 'lmstudio';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultBaseUrl: string | null;
  kind: 'openai-compatible' | 'anthropic';
  requiresApiKey: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', kind: 'anthropic', requiresApiKey: true },
  { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'mistral', label: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'ollama', label: 'Ollama (Local)', defaultBaseUrl: 'http://localhost:11434/v1', kind: 'openai-compatible', requiresApiKey: false },
  { id: 'lmstudio', label: 'LM Studio', defaultBaseUrl: null, kind: 'openai-compatible', requiresApiKey: false },
];

export function providerMeta(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

function providerLabel(id: string): string {
  return providerMeta(id)?.label ?? id;
}

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCallArgs {
  /** ProviderId real (seletor) ou "lovable" (fallback interno, sempre OpenAI-compatible). */
  provider: ProviderId | 'lovable';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  messages: ChatMessage[];
  maxTokens?: number;
}

export async function callChatCompletion(args: ChatCallArgs): Promise<string> {
  const isAnthropic =
    args.provider !== 'lovable' && providerMeta(args.provider)?.kind === 'anthropic';
  return isAnthropic ? callAnthropic(args) : callOpenAiCompatible(args);
}

async function callOpenAiCompatible(args: ChatCallArgs): Promise<string> {
  const res = await fetch(`${args.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      messages: args.messages,
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${providerLabel(args.provider)} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content;
  if (content === undefined) {
    throw new Error(`Resposta inválida de ${providerLabel(args.provider)}`);
  }
  return content ?? '';
}

async function callAnthropic(args: ChatCallArgs): Promise<string> {
  const system = args.messages.find((m) => m.role === 'system')?.content ?? '';
  const rest = args.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const res = await fetch(`${args.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': args.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
      temperature: args.temperature,
      system: system || undefined,
      messages: rest,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    content?: { type: string; text?: string }[];
  };
  const blocks = Array.isArray(json.content) ? json.content : [];
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}
