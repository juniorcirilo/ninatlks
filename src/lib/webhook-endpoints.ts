import { apiClient } from "@/lib/api-client";

/** Destino de webhook de envio (Nina Talks → sistema do cliente). */
export interface WebhookEndpoint {
  id: string;
  name: string;
  url: string;
  /** POST manda o JSON no corpo. GET manda o mesmo JSON em ?payload= (útil pra reaproveitar webhook do n8n criado em GET). */
  method: "GET" | "POST";
  /** Vazio = todos os eventos. */
  events: string[];
  secret: string;
  active: boolean;
  /** Agente ao qual este destino é restrito. null = destino global (recebe eventos de qualquer agente). */
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEndpointInput {
  name: string;
  url: string;
  method?: "GET" | "POST";
  events?: string[];
  active?: boolean;
  agent_id?: string | null;
}

/** Espelha WEBHOOK_EVENTS no servidor — evento fora da lista é recusado lá. */
export const WEBHOOK_EVENT_CATALOG: Array<{
  event: string;
  label: string;
  desc: string;
}> = [
  {
    event: "call.finished",
    label: "Ligação encerrada",
    desc: "Fim da chamada, com duração, desfecho e resumo.",
  },
  {
    event: "call.transferred",
    label: "Transferência para humano",
    desc: "A Nina passou a ligação para um atendente.",
  },
  {
    event: "meeting.scheduled",
    label: "Reunião agendada",
    desc: "A Nina marcou horário com o contato.",
  },
  {
    event: "meeting.rescheduled",
    label: "Reunião remarcada",
    desc: "Uma reunião existente mudou de horário.",
  },
  {
    event: "campaign.finished",
    label: "Campanha concluída",
    desc: "Todos os contatos da campanha foram trabalhados.",
  },
  {
    event: "contact.disposition_changed",
    label: "Desfecho do contato",
    desc: "Mudança de desfecho do contato dentro de uma campanha.",
  },
];

/** `agentId` filtra para "destinos deste agente + destinos globais" — é o que a aba do agente mostra. */
export async function fetchWebhookEndpoints(
  accountId: string,
  agentId?: string,
): Promise<WebhookEndpoint[]> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : "";
  return apiClient.get<WebhookEndpoint[]>(`/accounts/${accountId}/webhook-endpoints${qs}`);
}

export async function createWebhookEndpoint(
  accountId: string,
  input: WebhookEndpointInput,
): Promise<WebhookEndpoint> {
  return apiClient.post<WebhookEndpoint>(`/accounts/${accountId}/webhook-endpoints`, input);
}

export async function updateWebhookEndpoint(
  accountId: string,
  id: string,
  patch: Partial<WebhookEndpointInput>,
): Promise<WebhookEndpoint> {
  return apiClient.patch<WebhookEndpoint>(
    `/accounts/${accountId}/webhook-endpoints/${id}`,
    patch,
  );
}

export async function rotateWebhookEndpointSecret(
  accountId: string,
  id: string,
): Promise<WebhookEndpoint> {
  return apiClient.post<WebhookEndpoint>(
    `/accounts/${accountId}/webhook-endpoints/${id}/rotate-secret`,
  );
}

export async function deleteWebhookEndpoint(accountId: string, id: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/webhook-endpoints/${id}`);
}
