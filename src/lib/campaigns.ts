import { supabase } from "@/integrations/supabase/client";

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
  const { data, error } = await (supabase as any)
    .from("voice_campaigns")
    .select(
      "id,name,status,campaign_kind,total_contacts,placed_count,connected_count,escalated_count,voicemail_count,failed_count,created_at,scheduled_at,started_at,finished_at",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as CampaignRow[];
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
  const { data, error } = await (supabase as any)
    .from("contact_lists")
    .select("id,name,description,campaign_kind,is_dynamic,member_count,filters,created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ContactListRow[];
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
  const { data, error } = await (supabase as any)
    .from("retention_rules")
    .select(
      "id,name,enabled,inactive_days,required_stage_id,required_tag_ids,target_campaign_id,max_enrolls_per_run,last_run_at,last_enrolled_count,created_at",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RetentionRuleRow[];
}

export async function upsertRetentionRule(
  accountId: string,
  rule: Partial<RetentionRuleRow> & { name: string },
): Promise<void> {
  const payload: Record<string, unknown> = {
    account_id: accountId,
    name: rule.name,
    enabled: rule.enabled ?? true,
    inactive_days: rule.inactive_days ?? 60,
    required_stage_id: rule.required_stage_id ?? null,
    required_tag_ids: rule.required_tag_ids ?? [],
    target_campaign_id: rule.target_campaign_id ?? null,
    max_enrolls_per_run: rule.max_enrolls_per_run ?? 50,
  };
  const q = (supabase as any).from("retention_rules");
  const { error } = rule.id
    ? await q.update(payload).eq("id", rule.id)
    : await q.insert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteRetentionRule(id: string): Promise<void> {
  const { error } = await (supabase as any).from("retention_rules").delete().eq("id", id);
  if (error) throw new Error(error.message);
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
