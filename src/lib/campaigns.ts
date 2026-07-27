import { apiClient } from "@/lib/api-client";

export type CampaignKind = "sdr" | "pos_venda" | "cobranca" | "retencao" | "custom";

export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = {
  sdr: "IA SDR",
  pos_venda: "IA Pós-venda",
  cobranca: "IA Cobrança",
  retencao: "IA Retenção",
  custom: "Personalizada",
};

export const CAMPAIGN_KIND_DESC: Record<CampaignKind, string> = {
  sdr: "Prospecção e qualificação BANT",
  pos_venda: "NPS, CSAT, recompra e onboarding",
  cobranca: "Lembretes humanizados de pagamento",
  retencao: "Reativação de clientes inativos",
  custom: "Fluxo livre",
};

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "canceled";

export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  running: "Em execução",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
};

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  campaign_kind: string | null;
  total_contacts: number;
  placed_count: number;
  connected_count: number;
  escalated_count: number;
  voicemail_count: number;
  failed_count: number;
  created_at: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export async function fetchCampaigns(accountId: string): Promise<CampaignRow[]> {
  return apiClient.get<CampaignRow[]>(`/accounts/${accountId}/campaigns`);
}

export type CampaignDetail = CampaignRow & { opening_script: string | null; from_number: string };

export async function fetchCampaign(accountId: string, id: string): Promise<CampaignDetail> {
  return apiClient.get<CampaignDetail>(`/accounts/${accountId}/campaigns/${id}`);
}

export type CampaignContactRow = {
  id: string;
  to_number: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
  voice_call_id: string | null;
};

export async function fetchCampaignContacts(
  accountId: string,
  id: string,
): Promise<CampaignContactRow[]> {
  return apiClient.get<CampaignContactRow[]>(`/accounts/${accountId}/campaigns/${id}/contacts`);
}

export async function updateCampaignStatus(
  accountId: string,
  id: string,
  status: string,
): Promise<void> {
  await apiClient.patch(`/accounts/${accountId}/campaigns/${id}/status`, { status });
}

export type PersonaLite = {
  id: string;
  name: string;
  voice_clone_id: string | null;
  status: string;
  enabled: boolean;
};

export async function fetchCampaignPersonas(accountId: string): Promise<PersonaLite[]> {
  return apiClient.get<PersonaLite[]>(`/accounts/${accountId}/campaigns/personas`);
}

export type PhoneNumberLite = {
  id: string;
  e164: string;
  friendly_name: string | null;
  outbound_enabled: boolean;
  enabled: boolean;
};

export async function fetchCampaignPhoneNumbers(accountId: string): Promise<PhoneNumberLite[]> {
  return apiClient.get<PhoneNumberLite[]>(`/accounts/${accountId}/campaigns/phone-numbers`);
}

export async function createCampaign(
  accountId: string,
  input: {
    name: string;
    campaignKind: CampaignKind;
    listId: string;
    personaId: string;
    phoneId: string;
    openingScript?: string;
    maxConcurrent?: number;
    retryAttempts?: number;
    recordCall?: boolean;
  },
): Promise<{ id: string; contactCount: number }> {
  return apiClient.post<{ id: string; contactCount: number }>(
    `/accounts/${accountId}/campaigns`,
    input,
  );
}

export type ContactListRow = {
  id: string;
  name: string;
  description: string | null;
  campaign_kind: string | null;
  is_dynamic: boolean;
  member_count: number;
  filters: Record<string, unknown>;
  created_at: string;
};

export async function fetchContactLists(accountId: string): Promise<ContactListRow[]> {
  return apiClient.get<ContactListRow[]>(`/accounts/${accountId}/campaigns/contact-lists`);
}

// ============ Retention Rules ============

export type RetentionRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  inactive_days: number;
  required_stage_id: string | null;
  required_tag_ids: string[];
  target_campaign_id: string | null;
  max_enrolls_per_run: number;
  last_run_at: string | null;
  last_enrolled_count: number;
  created_at: string;
};

export async function fetchRetentionRules(accountId: string): Promise<RetentionRuleRow[]> {
  return apiClient.get<RetentionRuleRow[]>(`/accounts/${accountId}/retention-rules`);
}

export async function upsertRetentionRule(
  accountId: string,
  rule: Partial<RetentionRuleRow> & { name: string },
): Promise<void> {
  const payload = {
    name: rule.name,
    enabled: rule.enabled ?? true,
    inactiveDays: rule.inactive_days ?? 60,
    requiredStageId: rule.required_stage_id ?? null,
    requiredTagIds: rule.required_tag_ids ?? [],
    targetCampaignId: rule.target_campaign_id ?? null,
    maxEnrollsPerRun: rule.max_enrolls_per_run ?? 50,
  };
  if (rule.id) {
    await apiClient.patch(`/accounts/${accountId}/retention-rules/${rule.id}`, payload);
  } else {
    await apiClient.post(`/accounts/${accountId}/retention-rules`, payload);
  }
}

export async function deleteRetentionRule(accountId: string, id: string): Promise<void> {
  await apiClient.delete(`/accounts/${accountId}/retention-rules/${id}`);
}

// ============ Aggregated KPIs ============

export type CampaignsAggregate = {
  total_campaigns: number;
  running: number;
  total_contacts: number;
  placed: number;
  connected: number;
  escalated: number;
  voicemail: number;
  failed: number;
  by_kind: Record<string, { total: number; connected: number; campaigns: number }>;
};

export function aggregateCampaigns(rows: CampaignRow[]): CampaignsAggregate {
  const agg: CampaignsAggregate = {
    total_campaigns: rows.length,
    running: 0,
    total_contacts: 0,
    placed: 0,
    connected: 0,
    escalated: 0,
    voicemail: 0,
    failed: 0,
    by_kind: {},
  };
  for (const r of rows) {
    if (r.status === "running") agg.running += 1;
    agg.total_contacts += r.total_contacts;
    agg.placed += r.placed_count;
    agg.connected += r.connected_count;
    agg.escalated += r.escalated_count;
    agg.voicemail += r.voicemail_count;
    agg.failed += r.failed_count;
    const k = r.campaign_kind ?? "custom";
    const cur = agg.by_kind[k] ?? { total: 0, connected: 0, campaigns: 0 };
    cur.total += r.total_contacts;
    cur.connected += r.connected_count;
    cur.campaigns += 1;
    agg.by_kind[k] = cur;
  }
  return agg;
}
