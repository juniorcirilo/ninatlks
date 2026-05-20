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
