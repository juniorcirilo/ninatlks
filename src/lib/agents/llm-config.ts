// Resolve qual LLM os Funcionários IA (Bruno, Ana, Carla, Felipe, Clara,
// Diego, Supervisor, Playground/ask-persona) usam pra conversar.
//
// Cascata de prioridade:
//   1. "Provedor de IA do Agente" (novo seletor: OpenAI/Gemini/Anthropic/Groq/
//      DeepSeek/Mistral/Ollama/LM Studio — account_secrets provider 'agent-llm').
//   2. "IA própria" legada (account_secrets provider 'custom-llm') — a mesma
//      fonte que os agentes de voz usam via ElevenLabsAgentService no NestJS.
//      Mantida como fallback pra não regredir quem já tinha isso funcionando
//      antes do seletor novo existir.
//   3. Lovable AI Gateway, se LOVABLE_API_KEY estiver no ambiente.
import { query } from "@/lib/db";
import { providerMeta, type ProviderId } from "./providers";

export interface ResolvedLlmConfig {
  provider: ProviderId | "lovable";
  /** Base URL (sem o path final /chat/completions ou /v1/messages). */
  baseUrl: string;
  /** Pode ser vazio — servidor local (Ollama/LM Studio) geralmente não exige auth. */
  apiKey: string;
  model: string;
  temperature: number;
}

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1";
const AGENT_LLM_PROVIDER = "agent-llm";
const LEGACY_CUSTOM_LLM_PROVIDER = "custom-llm";

async function secretsBundle(accountId: string, provider: string): Promise<Record<string, string>> {
  const rows = await query<{ key_name: string; decrypted_secret: string }>(
    `SELECT s.key_name, vs.decrypted_secret
       FROM account_secrets s
       JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
      WHERE s.account_id = $1 AND s.provider = $2`,
    [accountId, provider],
  );
  return Object.fromEntries(rows.map((r) => [r.key_name, r.decrypted_secret]));
}

export async function resolveLlmConfig(
  accountId: string,
  fallbackModel = "google/gemini-2.5-flash",
  fallbackTemperature = 0.4,
): Promise<ResolvedLlmConfig> {
  const agentLlm = await secretsBundle(accountId, AGENT_LLM_PROVIDER);
  const providerId = (agentLlm.provider ?? "").trim();
  if (providerId) {
    const meta = providerMeta(providerId);
    const baseUrl = (agentLlm.base_url || meta.defaultBaseUrl || "").trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(
        `Provedor "${meta.label}" está selecionado mas sem Base URL — configure em Configurações → Integrações → Provedor de IA do Agente.`,
      );
    }
    const apiKey = (agentLlm.api_key ?? "").trim();
    if (meta.requiresApiKey && !apiKey) {
      throw new Error(
        `Provedor "${meta.label}" está selecionado mas sem API Key — configure em Configurações → Integrações → Provedor de IA do Agente.`,
      );
    }
    const temperature = Number(agentLlm.temperature);
    return {
      provider: meta.id,
      baseUrl,
      apiKey,
      model: (agentLlm.model_id ?? "").trim() || "default",
      temperature: Number.isFinite(temperature) ? temperature : fallbackTemperature,
    };
  }

  const legacy = await secretsBundle(accountId, LEGACY_CUSTOM_LLM_PROVIDER);
  const legacyUrl = (legacy.api_url ?? "").trim().replace(/\/+$/, "");
  if (legacyUrl) {
    return {
      provider: "lmstudio",
      baseUrl: legacyUrl,
      apiKey: (legacy.api_key ?? "").trim(),
      model: (legacy.model_id ?? "").trim() || "local-model",
      temperature: fallbackTemperature,
    };
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) {
    throw new Error(
      "Nenhum provedor de IA configurado para os Funcionários IA. Configure em Configurações → Integrações → Provedor de IA do Agente.",
    );
  }
  return { provider: "lovable", baseUrl: LOVABLE_GATEWAY, apiKey: lovableKey, model: fallbackModel, temperature: fallbackTemperature };
}
