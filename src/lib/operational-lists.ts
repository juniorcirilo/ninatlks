import { apiClient } from "@/lib/api-client";

/**
 * Lista operacional — o destino dos contatos recebidos por webhook e a origem
 * que a campanha de voz aponta em `source_list_id`.
 */
export interface OperationalList {
  id: string;
  name: string;
  description: string | null;
  campaignKind: string | null;
  /** `listKey` que o payload de recebimento manda para cair nesta lista. */
  externalKey: string | null;
  memberCount: number;
  filters: Record<string, unknown>;
  createdAt: string;
}

export interface OperationalListInput {
  name: string;
  description?: string | null;
  campaignKind?: string;
  externalKey?: string | null;
}

/** Espelha CAMPAIGN_KINDS no servidor. */
export const CAMPAIGN_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "sdr", label: "SDR — prospecção" },
  { value: "cobranca", label: "Cobrança" },
  { value: "pos_venda", label: "Pós-venda" },
  { value: "retencao", label: "Retenção" },
  { value: "custom", label: "Personalizada" },
];

export async function fetchOperationalLists(accountId: string): Promise<OperationalList[]> {
  return apiClient.get<OperationalList[]>(`/accounts/${accountId}/contact-lists`);
}

export async function createOperationalList(
  accountId: string,
  input: OperationalListInput,
): Promise<string> {
  return apiClient.post<string>(`/accounts/${accountId}/contact-lists`, input);
}

export async function updateOperationalList(
  accountId: string,
  listId: string,
  patch: Partial<OperationalListInput>,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/contact-lists/${listId}`, patch);
}

export async function deleteOperationalList(
  accountId: string,
  listId: string,
): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/contact-lists/${listId}`);
}

/**
 * Sugestão de chave a partir do nome: minúsculas, sem acento, separado por
 * hífen. O usuário pode trocar — é a chave que o sistema dele vai mandar.
 */
export function slugifyKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
