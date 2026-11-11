import { apiClient } from "@/lib/api-client";

export type Departamento = "COMERCIAL" | "FINANCEIRO";

export interface SalesRep {
  id: string;
  nome: string;
  aliases: string[];
  phone_e164: string | null;
  email: string | null;
  user_id: string | null;
  active: boolean;
  departamento: Departamento;
  is_default: boolean;
  nome_falado: string | null;
}

export type PendenciaReason =
  | "sem_cadastro"
  | "sem_telefone"
  | "sem_vendedor"
  | "sem_atendente_padrao";

export interface SalesRepPendencia {
  id: string;
  departamento: Departamento;
  vendedor_nome: string | null;
  vendedor_key: string;
  reason: PendenciaReason;
  campaign_id: string | null;
  fallback_number: string | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface SalesRepInput {
  nome: string;
  aliases?: string[];
  phone?: string | null;
  email?: string | null;
  active?: boolean;
  /** COMERCIAL (default) ou FINANCEIRO — cobrança só transborda para FINANCEIRO. */
  departamento?: Departamento;
  /** Atendente padrão do departamento (um ativo por departamento). Exige telefone. */
  isDefault?: boolean;
  /** Como a IA cita o destino (ex.: "nossa central de atendimento comercial"). */
  nomeFalado?: string | null;
}

export interface BulkSalesRepsResult {
  created: number;
  updated: number;
  errors: { nome: string; error: string }[];
}

const base = (accountId: string) => `/accounts/${accountId}/sales-reps`;

export const listSalesReps = (accountId: string) => apiClient.get<SalesRep[]>(base(accountId));

export const listSalesRepPendencias = (accountId: string) =>
  apiClient.get<SalesRepPendencia[]>(`${base(accountId)}/pendencias`);

export const createSalesRep = (accountId: string, input: SalesRepInput) =>
  apiClient.post<SalesRep>(base(accountId), input);

export const updateSalesRep = (accountId: string, id: string, input: SalesRepInput) =>
  apiClient.patch<SalesRep>(`${base(accountId)}/${id}`, input);

export const deleteSalesRep = (accountId: string, id: string) =>
  apiClient.delete<{ ok: true }>(`${base(accountId)}/${id}`);

export const bulkSalesReps = (accountId: string, items: SalesRepInput[]) =>
  apiClient.post<BulkSalesRepsResult>(`${base(accountId)}/bulk`, { items });

/**
 * Importação em texto: uma linha por vendedor, colunas separadas por `;` ou tab:
 * nome ; telefone ; email ; aliases (separados por |). Cabeçalho opcional.
 */
export function parseSalesRepsText(text: string): SalesRepInput[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => line.split(/[;\t]/).map((c) => c.trim()))
    .filter((cols) => !/^nome$/i.test(cols[0] ?? ""))
    .map(([nome, phone, email, aliases]) => ({
      nome: nome ?? "",
      phone: phone || null,
      email: email || null,
      aliases: aliases ? aliases.split("|").map((a) => a.trim()).filter(Boolean) : [],
    }))
    .filter((i) => i.nome.length >= 2);
}
