import { supabase } from "@/integrations/supabase/client";

export type LifecycleStage = "lead" | "prospect" | "customer" | "inactive" | "delinquent";
export type OperationalStatus =
  | "new"
  | "sdr"
  | "qualifying"
  | "negotiating"
  | "closed_won"
  | "closed_lost"
  | "collections"
  | "post_sale"
  | "retention"
  | "no_response"
  | "do_not_contact";

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  lead: "Lead",
  prospect: "Prospect",
  customer: "Cliente",
  inactive: "Inativo",
  delinquent: "Inadimplente",
};

export const OPERATIONAL_LABEL: Record<OperationalStatus, string> = {
  new: "Novo",
  sdr: "SDR",
  qualifying: "Qualificando",
  negotiating: "Negociação",
  closed_won: "Ganho",
  closed_lost: "Perdido",
  collections: "Cobrança",
  post_sale: "Pós-venda",
  retention: "Retenção",
  no_response: "Sem retorno",
  do_not_contact: "Não contatar",
};

export const OPERATIONAL_TONE: Record<OperationalStatus, string> = {
  new: "bg-slate-500/10 text-slate-300 ring-slate-500/20",
  sdr: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  qualifying: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  negotiating: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  closed_won: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  closed_lost: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  collections: "bg-orange-500/10 text-orange-300 ring-orange-500/30",
  post_sale: "bg-teal-500/10 text-teal-300 ring-teal-500/30",
  retention: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/30",
  no_response: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
  do_not_contact: "bg-red-500/10 text-red-300 ring-red-500/30",
};

export type CentralContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
  score: number;
  lifecycle_stage: LifecycleStage;
  operational_status: OperationalStatus;
  last_sentiment: string | null;
  last_activity_at: string | null;
  last_call_at: string | null;
  last_whatsapp_at: string | null;
  owner_user_id: string | null;
  briefing: any;
};

export type QuickFilter =
  | "all"
  | "sdr"
  | "qualifying"
  | "negotiating"
  | "collections"
  | "post_sale"
  | "retention"
  | "hot"
  | "no_response"
  | "inactive"
  | "delinquent"
  | "customers";

export const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "hot", label: "🔥 Leads quentes" },
  { id: "sdr", label: "SDR" },
  { id: "qualifying", label: "Qualificando" },
  { id: "negotiating", label: "Negociação" },
  { id: "customers", label: "Clientes" },
  { id: "post_sale", label: "Pós-venda" },
  { id: "retention", label: "Retenção" },
  { id: "collections", label: "Cobrança" },
  { id: "delinquent", label: "Inadimplentes" },
  { id: "no_response", label: "Sem retorno" },
  { id: "inactive", label: "Inativos" },
];

export async function fetchCentralContacts(accountId: string): Promise<CentralContact[]> {
  const { data, error } = await (supabase as any)
    .from("contacts")
    .select(
      "id,name,email,phone_number,identifier,score,lifecycle_stage,operational_status,last_sentiment,last_activity_at,last_call_at,last_whatsapp_at,owner_user_id,briefing",
    )
    .eq("account_id", accountId)
    .eq("blocked", false)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as CentralContact[];
}

export function applyQuickFilter(rows: CentralContact[], q: QuickFilter): CentralContact[] {
  switch (q) {
    case "all":
      return rows;
    case "hot":
      return rows.filter((r) => (r.score ?? 0) >= 75);
    case "sdr":
    case "qualifying":
    case "negotiating":
    case "collections":
    case "post_sale":
    case "retention":
    case "no_response":
      return rows.filter((r) => r.operational_status === q);
    case "customers":
      return rows.filter((r) => r.lifecycle_stage === "customer");
    case "inactive":
      return rows.filter((r) => r.lifecycle_stage === "inactive");
    case "delinquent":
      return rows.filter((r) => r.lifecycle_stage === "delinquent");
  }
}

export async function updateContactOps(
  id: string,
  patch: Partial<Pick<CentralContact, "lifecycle_stage" | "operational_status" | "owner_user_id">>,
) {
  const { error } = await (supabase as any).from("contacts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function fetchContactTimeline(contactId: string, accountId: string) {
  const [calls, convs, lists] = await Promise.all([
    (supabase as any)
      .from("voice_calls")
      .select("id,status,started_at,ended_at,duration_seconds,summary,sentiment,classification")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .order("started_at", { ascending: false })
      .limit(20),
    (supabase as any)
      .from("conversations")
      .select("id,display_id,status,last_activity_at,cached_label_list")
      .eq("account_id", accountId)
      .eq("contact_id", contactId)
      .order("last_activity_at", { ascending: false })
      .limit(20),
    (supabase as any)
      .from("contact_list_members")
      .select("list_id,added_at,contact_lists(name,campaign_kind)")
      .eq("contact_id", contactId)
      .limit(20),
  ]);
  return {
    calls: (calls.data ?? []) as any[],
    conversations: (convs.data ?? []) as any[],
    lists: (lists.data ?? []) as any[],
  };
}

export function timeAgoShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
