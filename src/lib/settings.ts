import { apiClient } from "@/lib/api-client";

export type AvailabilityStatus = 0 | 1 | 2; // 0=offline 1=online 2=busy

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  0: "Offline",
  1: "Online",
  2: "Ocupado",
};

export async function updateAccountSettings(
  accountId: string,
  patch: { name?: string; support_email?: string },
) {
  await apiClient.patch(`/accounts/${accountId}`, {
    name: patch.name,
    supportEmail: patch.support_email,
  });
}

export async function fetchAccount(accountId: string) {
  const acct = await apiClient.get<{
    id: string;
    name: string;
    supportEmail: string | null;
    internalAttributes: Record<string, unknown>;
    dialingSettings: Record<string, unknown>;
  }>(`/accounts/${accountId}`);
  return {
    id: acct.id,
    name: acct.name,
    support_email: acct.supportEmail,
    internal_attributes: acct.internalAttributes,
    dialing_settings: acct.dialingSettings,
  };
}

// ===== Dialing settings =====
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type HourRange = [number, number] | null;

export interface DialingSettings {
  timezone: string;
  allowed_hours_local: Record<DayKey, HourRange>;
  max_attempts_per_day: number;
  min_minutes_between_attempts: number;
  /** Números (E.164) isentos de janela/limite/intervalo nas ligações avulsas — só pra teste, nunca pula DNC. */
  test_numbers: string[];
}

export const DEFAULT_DIALING_SETTINGS: DialingSettings = {
  timezone: "America/Sao_Paulo",
  allowed_hours_local: {
    mon: [9, 18],
    tue: [9, 18],
    wed: [9, 18],
    thu: [9, 18],
    fri: [9, 18],
    sat: null,
    sun: null,
  },
  max_attempts_per_day: 3,
  min_minutes_between_attempts: 60,
  test_numbers: [],
};

export async function fetchDialingSettings(accountId: string): Promise<DialingSettings> {
  return apiClient.get<DialingSettings>(`/accounts/${accountId}/dialing-settings`);
}

export async function updateDialingSettings(
  accountId: string,
  next: DialingSettings,
) {
  await apiClient.put(`/accounts/${accountId}/dialing-settings`, next);
}

export async function ensureWebhookSecret(accountId: string): Promise<string> {
  return apiClient.post<string>(`/accounts/${accountId}/webhook-secret`);
}

export async function setMyAvailability(
  accountId: string,
  _userId: string,
  availability: AvailabilityStatus,
) {
  await apiClient.put(`/accounts/${accountId}/my-availability`, { availability });
}

export async function getMyAvailability(
  accountId: string,
  _userId: string,
): Promise<AvailabilityStatus> {
  return apiClient.get<AvailabilityStatus>(`/accounts/${accountId}/my-availability`);
}

// ===== Reactions =====
// Depende da tabela `messages` (domínio de conversas omnichannel ainda não
// portado) — mantido no Supabase por enquanto. Sem consumidores no app hoje.
export type Reaction = {
  user_id: string;
  reaction: string;
  at: string;
};

export async function reactToMessage(messageId: string, userId: string, reaction: string) {
  throw new Error("Message reactions not yet migrated to new backend");
}


export async function removeReaction(messageId: string, userId: string) {
  throw new Error("Message reactions not yet migrated to new backend");
}
