import { supabase } from "@/integrations/supabase/client";

export interface DncEntry {
  id: number;
  account_id: string;
  phone_number: string;
  reason: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
}

export interface CompliancePolicy {
  allowed_hours_local?: Record<string, [number, number] | null>;
  max_attempts_per_day_per_contact?: number;
  min_minutes_between_attempts?: number;
  recording_disclaimer?: string;
}

// ─────────────────────────────────────────────────────────────
// DNC list
// ─────────────────────────────────────────────────────────────

export async function fetchDncList(accountId: string): Promise<DncEntry[]> {
  const { data, error } = await (supabase as any)
    .from("dnc_list")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DncEntry[];
}

export async function addToDnc(input: {
  accountId: string;
  phoneNumber: string;
  reason?: string;
  notes?: string;
}) {
  const { error } = await (supabase as any)
    .from("dnc_list")
    .insert({
      account_id: input.accountId,
      phone_number: input.phoneNumber,
      reason: input.reason ?? "manual",
      notes: input.notes,
    });
  if (error) throw error;
}

export async function removeFromDnc(id: number) {
  const { error } = await (supabase as any).from("dnc_list").delete().eq("id", id);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────
// Compliance policy (stored under accounts.internal_attributes.compliance)
// ─────────────────────────────────────────────────────────────

export async function fetchCompliancePolicy(accountId: string): Promise<CompliancePolicy> {
  const { data } = await supabase
    .from("accounts")
    .select("internal_attributes")
    .eq("id", accountId)
    .maybeSingle();
  return ((data?.internal_attributes as any)?.compliance ?? {}) as CompliancePolicy;
}

export async function saveCompliancePolicy(accountId: string, policy: CompliancePolicy) {
  const { data: existing } = await supabase
    .from("accounts")
    .select("internal_attributes")
    .eq("id", accountId)
    .maybeSingle();
  const attrs = (existing?.internal_attributes ?? {}) as Record<string, any>;
  attrs.compliance = policy;
  const { error } = await supabase
    .from("accounts")
    .update({ internal_attributes: attrs })
    .eq("id", accountId);
  if (error) throw error;
}

export const DEFAULT_COMPLIANCE_POLICY: CompliancePolicy = {
  allowed_hours_local: {
    mon: [9, 20],
    tue: [9, 20],
    wed: [9, 20],
    thu: [9, 20],
    fri: [9, 20],
    sat: [9, 14],
    sun: null,
  },
  max_attempts_per_day_per_contact: 2,
  min_minutes_between_attempts: 120,
  recording_disclaimer:
    "Esta ligação está sendo gravada para fins de qualidade e auditoria. Ao permanecer na chamada, você concorda com a gravação.",
};
