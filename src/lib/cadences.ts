import { apiClient } from "@/lib/api-client";

export type CadenceTriggerEvent = "stage_change" | "manual" | "no_show" | "meeting_attended";

export type CadenceChannel = "voice" | "whatsapp" | "email";

export type CadenceStep = {
  offset_hours: number;
  channel: CadenceChannel;
  template_key?: string | null;
};

export type Cadence = {
  id: string;
  name: string;
  description: string | null;
  trigger_event: CadenceTriggerEvent;
  trigger_stage_id: string | null;
  enabled: boolean;
  steps: CadenceStep[];
  pending_count: number;
  waiting_count: number;
  completed_count: number;
  failed_count: number;
};

export const TRIGGER_LABEL: Record<CadenceTriggerEvent, string> = {
  manual: "Manual",
  stage_change: "Quando entra no stage",
  no_show: "Quando dá no-show",
  meeting_attended: "Após reunião realizada",
};

export const CHANNEL_LABEL: Record<CadenceChannel, string> = {
  voice: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
};

export async function fetchCadences(accountId: string): Promise<Cadence[]> {
  return apiClient.get<Cadence[]>(`/accounts/${accountId}/cadences`);
}

export async function upsertCadence(input: {
  id?: string;
  account_id: string;
  name: string;
  description?: string | null;
  trigger_event: CadenceTriggerEvent;
  trigger_stage_id?: string | null;
  steps: CadenceStep[];
  enabled?: boolean;
}): Promise<string> {
  const { id } = await apiClient.post<{ id: string }>(`/accounts/${input.account_id}/cadences`, {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    trigger_event: input.trigger_event,
    trigger_stage_id: input.trigger_stage_id ?? null,
    steps: input.steps,
    enabled: input.enabled ?? true,
  });
  return id;
}

export async function deleteCadence(accountId: string, id: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/cadences/${id}`);
}

export async function enrollContactInCadence(
  accountId: string,
  cadenceId: string,
  contactId: string,
): Promise<string> {
  const { executionId } = await apiClient.post<{ executionId: string }>(
    `/accounts/${accountId}/cadences/${cadenceId}/enroll`,
    { contactId },
  );
  return executionId;
}
