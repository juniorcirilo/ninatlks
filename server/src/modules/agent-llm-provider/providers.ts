// Catálogo dos provedores de LLM suportados pela tela "Provedor de IA do
// Agente" (Configurações → Integrações). Espelha
// src/lib/agents/providers.ts (frontend/runtime dos Funcionários IA) — este
// arquivo aqui só cobre o que o backend precisa pra "Carregar modelos" e
// "Testar Conexão" (o navegador não pode chamar essas APIs direto: CORS e a
// chave não deveria trafegar por fora do backend).

export type AgentLlmProviderId =
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'ollama'
  | 'lmstudio';

export interface AgentLlmProviderMeta {
  id: AgentLlmProviderId;
  label: string;
  defaultBaseUrl: string | null;
  kind: 'openai-compatible' | 'anthropic';
  requiresApiKey: boolean;
}

export const AGENT_LLM_PROVIDERS: AgentLlmProviderMeta[] = [
  { id: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', kind: 'anthropic', requiresApiKey: true },
  { id: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'mistral', label: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1', kind: 'openai-compatible', requiresApiKey: true },
  { id: 'ollama', label: 'Ollama (Local)', defaultBaseUrl: 'http://localhost:11434/v1', kind: 'openai-compatible', requiresApiKey: false },
  { id: 'lmstudio', label: 'LM Studio', defaultBaseUrl: null, kind: 'openai-compatible', requiresApiKey: false },
];

export function agentLlmProviderMeta(id: string): AgentLlmProviderMeta {
  const found = AGENT_LLM_PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Provedor de IA desconhecido: ${id}`);
  return found;
}
