// Catálogo dos provedores de LLM suportados pela tela "Provedor de IA" e pela
// página Agente de IA. Fonte única: common/llm/providers.ts — este arquivo só
// mantém os nomes usados pelo módulo agent-llm-provider ("Carregar modelos" e
// "Testar Conexão" rodam no backend: CORS e a chave não devem passar pelo
// navegador).
import { PROVIDERS, type ProviderId, type ProviderMeta } from '../../common/llm/providers';

export type AgentLlmProviderId = ProviderId;
export type AgentLlmProviderMeta = ProviderMeta;

export const AGENT_LLM_PROVIDERS: AgentLlmProviderMeta[] = PROVIDERS;

export function agentLlmProviderMeta(id: string): AgentLlmProviderMeta {
  const found = AGENT_LLM_PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`Provedor de IA desconhecido: ${id}`);
  return found;
}
