import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type AvailabilityStatus = 0 | 1 | 2; // 0=offline 1=online 2=busy

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  0: "Offline",
  1: "Online",
  2: "Ocupado",
};

const AVAIL_ENUM_MAP: Record<AvailabilityStatus, "offline" | "online" | "busy"> = {
  0: "offline",
  1: "online",
  2: "busy",
};

const AVAIL_REVERSE: Record<string, AvailabilityStatus> = {
  offline: 0,
  online: 1,
  busy: 2,
};

export async function updateAccountSettings(
  accountId: string,
  patch: { name?: string; support_email?: string },
) {
  const update: { name?: string; support_email?: string } = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.support_email !== undefined) update.support_email = patch.support_email;
  const { error } = await supabase.from("accounts").update(update).eq("id", accountId);
  if (error) throw error;
}

export async function fetchAccount(accountId: string) {
  const { data, error } = await supabase
    .from("accounts")
    .select("id,name,support_email,internal_attributes,dialing_settings")
    .eq("id", accountId)
    .single();
  if (error) throw error;
  return data;
}

// ===== Dialing settings =====
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type HourRange = [number, number] | null;

export interface DialingSettings {
  timezone: string;
  allowed_hours_local: Record<DayKey, HourRange>;
  max_attempts_per_day: number;
  min_minutes_between_attempts: number;
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
};

export async function fetchDialingSettings(accountId: string): Promise<DialingSettings> {
  const { data, error } = await supabase
    .from("accounts")
    .select("dialing_settings")
    .eq("id", accountId)
    .single();
  if (error) throw error;
  const raw = (data?.dialing_settings ?? {}) as Partial<DialingSettings>;
  return {
    ...DEFAULT_DIALING_SETTINGS,
    ...raw,
    allowed_hours_local: {
      ...DEFAULT_DIALING_SETTINGS.allowed_hours_local,
      ...((raw.allowed_hours_local as Record<DayKey, HourRange>) ?? {}),
    },
  };
}

export async function updateDialingSettings(
  accountId: string,
  next: DialingSettings,
) {
  const { error } = await supabase
    .from("accounts")
    .update({ dialing_settings: next as unknown as Json })
    .eq("id", accountId);
  if (error) throw error;
}

export async function ensureWebhookSecret(accountId: string): Promise<string> {
  const acct = await fetchAccount(accountId);
  const attrs = (acct.internal_attributes ?? {}) as Record<string, unknown>;
  const existing = typeof attrs.webhookSecret === "string" ? attrs.webhookSecret : null;
  if (existing && existing.length >= 32) return existing;

  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const next = { ...attrs, webhookSecret: secret };
  const { error } = await supabase
    .from("accounts")
    .update({ internal_attributes: next as unknown as Json })
    .eq("id", accountId);
  if (error) throw error;
  return secret;
}

export async function setMyAvailability(
  accountId: string,
  userId: string,
  availability: AvailabilityStatus,
) {
  const { error } = await supabase
    .from("account_users")
    .update({
      availability: AVAIL_ENUM_MAP[availability],
      active_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function getMyAvailability(
  accountId: string,
  userId: string,
): Promise<AvailabilityStatus> {
  const { data } = await supabase
    .from("account_users")
    .select("availability")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return 0;
  return AVAIL_REVERSE[String(data.availability)] ?? 0;
}

// ===== Reactions =====
export type Reaction = {
  user_id: string;
  reaction: string;
  at: string;
};

export async function reactToMessage(messageId: string, userId: string, reaction: string) {
  const { data: msg, error: fetchErr } = await supabase
    .from("messages")
    .select("additional_attributes")
    .eq("id", messageId)
    .single();
  if (fetchErr) throw fetchErr;

  const attrs = (msg.additional_attributes ?? {}) as Record<string, unknown>;
  const reactions = Array.isArray(attrs.reactions) ? (attrs.reactions as Reaction[]) : [];

  // Upsert: replace existing reaction for this user
  const filtered = reactions.filter((r) => r.user_id !== userId);
  filtered.push({ user_id: userId, reaction, at: new Date().toISOString() });

  const next = { ...attrs, reactions: filtered };
  const { error } = await supabase
    .from("messages")
    .update({ additional_attributes: next as unknown as Json })
    .eq("id", messageId);
  if (error) throw error;
}

export async function removeReaction(messageId: string, userId: string) {
  const { data: msg, error: fetchErr } = await supabase
    .from("messages")
    .select("additional_attributes")
    .eq("id", messageId)
    .single();
  if (fetchErr) throw fetchErr;

  const attrs = (msg.additional_attributes ?? {}) as Record<string, unknown>;
  const reactions = Array.isArray(attrs.reactions) ? (attrs.reactions as Reaction[]) : [];
  const filtered = reactions.filter((r) => r.user_id !== userId);

  const next = { ...attrs, reactions: filtered };
  const { error } = await supabase
    .from("messages")
    .update({ additional_attributes: next as unknown as Json })
    .eq("id", messageId);
  if (error) throw error;
}
