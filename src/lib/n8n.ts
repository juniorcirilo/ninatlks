import { apiClient } from "@/lib/api-client";

/**
 * Integração com n8n: um workflow "Utalks" por conta, com um nó Webhook por
 * agente que tem fonte de dados configurada. Ver AgentSourcesController no
 * servidor (`/accounts/:id/agent-sources/n8n/*`).
 */
export interface EnsureN8nNodeResult {
  /** false quando a conta não tem n8n conectado em Configurações > Integrações. */
  configured: boolean;
  /** false quando o nó já existia — nada foi tocado no workflow do usuário. */
  created?: boolean;
  url?: string;
  workflowId?: string;
  nodeName?: string;
}

/**
 * Garante o nó Webhook de um agente no workflow Utalks. Chamado ao clicar em
 * "Configurar" para um agente sem fonte ainda — a URL devolvida pré-preenche
 * o formulário. Não lança quando o n8n não está configurado: devolve
 * `{ configured: false }`, que é o estado normal até o usuário conectar a
 * integração.
 */
export async function ensureN8nNode(
  accountId: string,
  input: { agentName: string; method?: "GET" | "POST" },
): Promise<EnsureN8nNodeResult> {
  return apiClient.post<EnsureN8nNodeResult>(
    `/accounts/${accountId}/agent-sources/n8n/ensure-node`,
    input,
  );
}

export interface SyncAllN8nResult {
  configured: boolean;
  total?: number;
  nodesCreated?: number;
  /** Fontes de dados criadas do zero — agente que não tinha nenhuma. */
  sourcesCreated?: number;
  sourcesUpdated?: number;
  results?: Array<{
    agentName: string;
    nodeCreated: boolean;
    sourceCreated: boolean;
    url?: string;
    error?: string;
  }>;
}

/**
 * Sincroniza todos os agentes da conta com o n8n. Para quem já tem fonte de
 * dados: só garante o nó no workflow, sem tocar na fonte ("se existir não
 * mexa"). Para quem não tem: garante o nó e já cria a fonte apontando para
 * ele — o mapeamento de campos (`field_map`) nasce vazio, porque não há como
 * adivinhar o formato do ERP do cliente; fica pendente de um "Editar".
 * Idempotente — rodar de novo não duplica nó nem fonte.
 */
export async function syncAgentSourcesToN8n(accountId: string): Promise<SyncAllN8nResult> {
  return apiClient.post<SyncAllN8nResult>(
    `/accounts/${accountId}/agent-sources/n8n/sync-all`,
  );
}

/**
 * Traduz o resultado da sincronização em mensagens prontas para toast. Extra
 * na lib (não só num componente) porque dois lugares disparam a mesma
 * sincronização — ao salvar as credenciais e pelo botão "Sincronizar" — e os
 * dois devem contar a mesma história do mesmo jeito.
 */
export function describeN8nSync(
  sync: SyncAllN8nResult,
): Array<{ level: "success" | "warning" | "info"; message: string }> {
  if (!sync.configured) return [];
  const messages: Array<{ level: "success" | "warning" | "info"; message: string }> = [];

  const failed = (sync.results ?? []).filter((r) => r.error);
  if (failed.length > 0) {
    messages.push({
      level: "warning",
      message: `n8n: ${failed.length} agente(s) não sincronizaram — ${failed
        .map((r) => r.agentName)
        .join(", ")}.`,
    });
  }

  const parts: string[] = [];
  if ((sync.sourcesCreated ?? 0) > 0) parts.push(`${sync.sourcesCreated} fonte(s) de dados nova(s)`);
  if ((sync.sourcesUpdated ?? 0) > 0) parts.push(`${sync.sourcesUpdated} fonte(s) atualizada(s) para POST`);
  if ((sync.nodesCreated ?? 0) > 0) parts.push(`${sync.nodesCreated} nó(s) criado(s)`);

  if ((sync.validationDisabled ?? []).length > 0) {
    messages.push({
      level: "warning",
      message: `Nós desativados por falta de query MSSQL: ${sync.validationDisabled!.join(", ")}.`,
    });
  }
  if (parts.length > 0) {
    messages.push({ level: "success", message: `Workflow "Utalks": ${parts.join(" · ")}.` });
  } else if (failed.length === 0 && !(sync.validationDisabled ?? []).length) {
    messages.push({
      level: "info",
      message: `Workflow "Utalks" já estava em dia — nada novo para criar.`,
    });
  }

  return messages;
}
