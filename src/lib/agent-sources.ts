import { apiClient } from "@/lib/api-client";

/**
 * Fonte de dados de um agente: nós buscamos no sistema do cliente e traduzimos
 * a resposta dele para os nossos campos.
 */
export interface AgentSource {
  id: string;
  agent_id: string;
  agent_name: string | null;
  name: string;
  url: string;
  method: "GET" | "POST";
  token_header: string;
  token_prefix: string;
  /** O token nunca volta do servidor — só se existe. */
  has_token: boolean;
  body_template: Record<string, unknown> | null;
  root_path: string | null;
  /** Campo nosso -> chave na resposta da fonte. */
  field_map: Record<string, string>;
  /** Variável da fala -> chave na resposta. */
  variables_map: Record<string, string>;
  list_key: string | null;
  /** Lista de destino resolvida: `list_key` ou a lista do agente. */
  effective_list_key: string;
  campaign_kind: string | null;
  schedule_minutes: number | null;
  active: boolean;
  running: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_count: number | null;
}

export interface AgentSourceInput {
  agentId?: string;
  name?: string;
  url?: string;
  method?: "GET" | "POST";
  /** Em branco mantém o token guardado — o formulário não consegue reexibi-lo. */
  token?: string;
  tokenHeader?: string;
  tokenPrefix?: string;
  bodyTemplate?: Record<string, unknown>;
  rootPath?: string;
  fieldMap?: Record<string, string>;
  variablesMap?: Record<string, string>;
  listKey?: string;
  campaignKind?: string;
  scheduleMinutes?: number;
  active?: boolean;
}

export interface RunResult {
  ok: boolean;
  fetched: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
  sample: Record<string, unknown>[];
  /** Variáveis mapeadas que não vieram em nenhuma linha. Informativo, não erro. */
  emptyVariables?: string[];
}

/** Campos nossos que o mapeamento pode preencher. `phone` é a chave do upsert. */
export const MAPPABLE_FIELDS: Array<{
  field: string;
  label: string;
  required: boolean;
  placeholder: string;
}> = [
  { field: "phone", label: "Telefone", required: true, placeholder: "cliente_fone" },
  { field: "name", label: "Nome", required: false, placeholder: "cliente_nome" },
  { field: "email", label: "E-mail", required: false, placeholder: "cliente_email" },
  {
    field: "externalId",
    label: "Código de origem",
    required: false,
    placeholder: "cod_cliente",
  },
];

export async function fetchAgentSources(accountId: string): Promise<AgentSource[]> {
  return apiClient.get<AgentSource[]>(`/accounts/${accountId}/agent-sources`);
}

export async function createAgentSource(
  accountId: string,
  input: AgentSourceInput,
): Promise<{ id: string }> {
  return apiClient.post<{ id: string }>(`/accounts/${accountId}/agent-sources`, input);
}

export async function updateAgentSource(
  accountId: string,
  id: string,
  patch: AgentSourceInput,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/agent-sources/${id}`, patch);
}

export async function deleteAgentSource(accountId: string, id: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/agent-sources/${id}`);
}

/** Busca agora: é o "Testar" da configuração e o "Sincronizar" da lista. */
export async function runAgentSource(
  accountId: string,
  id: string,
): Promise<RunResult> {
  return apiClient.post<RunResult>(`/accounts/${accountId}/agent-sources/${id}/run`);
}
