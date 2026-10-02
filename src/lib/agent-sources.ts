import { apiClient } from "@/lib/api-client";

/**
 * Fonte de dados de um agente: nós buscamos no sistema do cliente e traduzimos
 * a resposta dele para os nossos campos.
 */
export interface AgentSource {
  id: string;
  agent_id: string;
  agent_name: string | null;
  document_kind: string | null;
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
  /** Persona (uuid) da fonte — usado pra resolver manualmente uma falha de
   * "empresa não identificada" sem o operador ter que informar de novo. */
  agentId?: string;
  fetched: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
  sample: Record<string, unknown>[];
  /** Variáveis mapeadas que não vieram em nenhuma linha. Informativo, não erro. */
  emptyVariables?: string[];
  /** Linhas que não chegaram a virar contato nem título/orçamento no banco, com o motivo. */
  failures: {
    label: string;
    externalId?: string;
    vendedor?: string;
    reason: string;
    details: Record<string, unknown>;
  }[];
  /** Empresas dos clientes desta corrida, agrupadas — aba "Empresas" do
   * preview de sincronização. */
  companies: {
    companyId: string | null;
    companyName: string;
    externalId: string | null;
    contacts: { name: string | null; phone: string }[];
  }[];
  /** Lista operacional criada nesta corrida com os títulos/orçamentos novos
   * (agentes de cobrança/orçamento) — `null` se a fonte não for desse tipo
   * ou se não achou nada novo (tudo já estava numa lista em aberto). */
  operationalList: { id: string; name: string; itemCount: number } | null;
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
    label: "Código de origem (cliente)",
    required: false,
    placeholder: "cod_cliente",
  },
  {
    field: "empresaId",
    label: "Empresa (empresa_id)",
    required: false,
    placeholder: "cod_empresa — diferente do código do cliente",
  },
  {
    field: "empresaNome",
    label: "Nome da empresa",
    required: false,
    placeholder: "empresa_nome",
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

/** Falhas da última corrida desta fonte — sobrevive ao fechamento do modal de
 * sincronização, pra investigar depois sem sincronizar de novo. */
export async function fetchAgentSourceFailures(
  accountId: string,
  id: string,
): Promise<RunResult['failures']> {
  return apiClient.get(`/accounts/${accountId}/agent-sources/${id}/failures`);
}

/**
 * Reconciliação manual de uma linha de sync bloqueada por "empresa não
 * identificada" — reenvia os dados que a falha já trouxe (telefone/nome/
 * email/variables, tirados do `details`) mais a empresa escolhida/criada.
 */
export async function resolveAgentSourceFailure(
  accountId: string,
  input: {
    agent: string;
    phone: string;
    name?: string | null;
    email?: string | null;
    variables?: Record<string, unknown>;
    companyId: string;
  },
): Promise<{ ok: boolean; skipped: boolean; reason?: string }> {
  return apiClient.post(`/accounts/${accountId}/agent-sources/resolve-failure`, input);
}
