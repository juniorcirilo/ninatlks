import { DataSource } from 'typeorm';
import { providerMeta, type ProviderId } from './providers';

// Porta de src/lib/agents/llm-config.ts::resolveLlmConfig — mesma cascata de
// prioridade, para que o auto-reply de WhatsApp (e qualquer outro consumidor
// server-side) use exatamente o provedor que a conta já escolheu em
// Configurações → Integrações → Provedor de IA do Agente:
//   1. account_secrets['agent-llm'] (seletor novo).
//   2. account_secrets['custom-llm'] (legado — mesma fonte que os agentes de
//      voz via ElevenLabsAgentService::resolveCustomLlm).
//   3. LOVABLE_API_KEY do ambiente.
//
// Recebe `DataSource` direto (não Scope.REQUEST) para funcionar tanto dentro
// de um request HTTP quanto dentro de um processor BullMQ sem depender de
// contexto de request — mesmo motivo pelo qual `el-outbound-cron.util.ts` já
// duplica a leitura de account_secrets em vez de injetar SecretsService.

const LOVABLE_GATEWAY = 'https://ai.gateway.lovable.dev/v1';
const AGENT_LLM_PROVIDER = 'agent-llm';
const LEGACY_CUSTOM_LLM_PROVIDER = 'custom-llm';

export interface ResolvedLlmConfig {
  provider: ProviderId | 'lovable';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

async function secretsBundle(
  dataSource: DataSource,
  accountId: string,
  provider: string,
): Promise<Record<string, string>> {
  const rows = await dataSource.query<
    { key_name: string; decrypted_secret: string }[]
  >(
    `SELECT s.key_name, vs.decrypted_secret
       FROM public.account_secrets s
       JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
      WHERE s.account_id = $1 AND s.provider = $2`,
    [accountId, provider],
  );
  return Object.fromEntries(rows.map((r) => [r.key_name, r.decrypted_secret]));
}

export class LlmNotConfiguredError extends Error {}

export async function resolveLlmConfig(
  dataSource: DataSource,
  accountId: string,
  fallbackModel = 'google/gemini-2.5-flash',
  fallbackTemperature = 0.4,
): Promise<ResolvedLlmConfig> {
  const agentLlm = await secretsBundle(dataSource, accountId, AGENT_LLM_PROVIDER);
  const providerId = (agentLlm.provider ?? '').trim();
  if (providerId) {
    const meta = providerMeta(providerId);
    if (!meta) {
      throw new LlmNotConfiguredError(`Provedor de IA desconhecido: ${providerId}`);
    }
    const baseUrl = (agentLlm.base_url || meta.defaultBaseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new LlmNotConfiguredError(
        `Provedor "${meta.label}" está selecionado mas sem Base URL — configure em Configurações → Integrações → Provedor de IA do Agente.`,
      );
    }
    const apiKey = (agentLlm.api_key ?? '').trim();
    if (meta.requiresApiKey && !apiKey) {
      throw new LlmNotConfiguredError(
        `Provedor "${meta.label}" está selecionado mas sem API Key — configure em Configurações → Integrações → Provedor de IA do Agente.`,
      );
    }
    const temperature = Number(agentLlm.temperature);
    return {
      provider: meta.id,
      baseUrl,
      apiKey,
      model: (agentLlm.model_id ?? '').trim() || 'default',
      temperature: Number.isFinite(temperature) ? temperature : fallbackTemperature,
    };
  }

  const legacy = await secretsBundle(dataSource, accountId, LEGACY_CUSTOM_LLM_PROVIDER);
  const legacyUrl = (legacy.api_url ?? '').trim().replace(/\/+$/, '');
  if (legacyUrl) {
    return {
      provider: 'lmstudio',
      baseUrl: legacyUrl,
      apiKey: (legacy.api_key ?? '').trim(),
      model: (legacy.model_id ?? '').trim() || 'local-model',
      temperature: fallbackTemperature,
    };
  }

  const lovableKey = process.env.LOVABLE_API_KEY;
  if (!lovableKey) {
    throw new LlmNotConfiguredError(
      'Nenhum provedor de IA configurado. Configure em Configurações → Integrações → Provedor de IA do Agente.',
    );
  }
  return {
    provider: 'lovable',
    baseUrl: LOVABLE_GATEWAY,
    apiKey: lovableKey,
    model: fallbackModel,
    temperature: fallbackTemperature,
  };
}
