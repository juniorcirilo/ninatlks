import { apiClient } from "@/lib/api-client";

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
  return apiClient.get<DncEntry[]>(`/accounts/${accountId}/dnc`);
}

export async function addToDnc(input: {
  accountId: string;
  phoneNumber: string;
  reason?: string;
  notes?: string;
}) {
  await apiClient.post(`/accounts/${input.accountId}/dnc`, {
    phoneNumber: input.phoneNumber,
    reason: input.reason,
    notes: input.notes,
  });
}

export async function removeFromDnc(accountId: string, id: number) {
  await apiClient.delete(`/accounts/${accountId}/dnc/${id}`);
}

// ─────────────────────────────────────────────────────────────
// Compliance policy (stored under accounts.internal_attributes.compliance)
// ─────────────────────────────────────────────────────────────

export async function fetchCompliancePolicy(accountId: string): Promise<CompliancePolicy> {
  return apiClient.get<CompliancePolicy>(`/accounts/${accountId}/compliance-policy`);
}

export async function saveCompliancePolicy(accountId: string, policy: CompliancePolicy) {
  await apiClient.put(`/accounts/${accountId}/compliance-policy`, { policy });
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
