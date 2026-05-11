// Resolves per-channel Meta credentials from `channels.config`.
// Falls back to env vars when the channel hasn't stored its own token —
// this lets a single WhatsApp-for-dev config bootstrap all accounts.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export interface WhatsAppConfig {
  channelId: string;
  accountId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
  displayPhoneNumber?: string;
  defaultTemplate?: string;
}

export interface InstagramConfig {
  channelId: string;
  accountId: string;
  igUserId: string;
  pageId?: string;
  accessToken: string;
}

export interface MessengerConfig {
  channelId: string;
  accountId: string;
  pageId: string;
  accessToken: string;
}

export class ChannelConfigError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChannelConfigError";
    this.status = status;
  }
}

export async function loadWhatsAppConfig(
  admin: SupabaseClient,
  channelId: string,
): Promise<WhatsAppConfig> {
  const { data, error } = await admin
    .from("channels")
    .select("id, account_id, channel_type, config, enabled")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw new ChannelConfigError(`channel lookup failed: ${error.message}`, 500);
  if (!data) throw new ChannelConfigError("channel not found", 404);
  if (data.channel_type !== "whatsapp") throw new ChannelConfigError("channel is not whatsapp", 400);
  if (!data.enabled) throw new ChannelConfigError("channel disabled", 409);

  const cfg = (data.config ?? {}) as Record<string, any>;
  const wabaId = cfg.waba_id ?? cfg.whatsapp_business_account_id ?? Deno.env.get("WHATSAPP_BUSINESS_ACCOUNT_ID");
  const phoneNumberId = cfg.phone_number_id ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const accessToken = cfg.access_token ?? Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId) throw new ChannelConfigError("phone_number_id not configured", 409);
  if (!accessToken) throw new ChannelConfigError("access_token not configured", 409);

  return {
    channelId: data.id,
    accountId: data.account_id,
    wabaId: wabaId ?? "",
    phoneNumberId,
    accessToken,
    displayPhoneNumber: cfg.display_phone_number,
    defaultTemplate: cfg.default_template,
  };
}

export async function loadInstagramConfig(
  admin: SupabaseClient,
  channelId: string,
): Promise<InstagramConfig> {
  const { data, error } = await admin
    .from("channels")
    .select("id, account_id, channel_type, config, enabled")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw new ChannelConfigError(`channel lookup failed: ${error.message}`, 500);
  if (!data) throw new ChannelConfigError("channel not found", 404);
  if (data.channel_type !== "instagram") throw new ChannelConfigError("channel is not instagram", 400);
  if (!data.enabled) throw new ChannelConfigError("channel disabled", 409);

  const cfg = (data.config ?? {}) as Record<string, any>;
  const igUserId = cfg.ig_user_id ?? cfg.ig_account_id;
  const accessToken = cfg.access_token ?? Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
  if (!accessToken) throw new ChannelConfigError("access_token not configured", 409);

  return {
    channelId: data.id,
    accountId: data.account_id,
    igUserId: igUserId ?? "me",
    pageId: cfg.page_id,
    accessToken,
  };
}

/**
 * Locate the channel that owns a given WhatsApp phone_number_id.
 * Used by inbound webhooks to route events to the correct tenant.
 */
export async function findWhatsAppChannelByPhoneId(
  admin: SupabaseClient,
  phoneNumberId: string,
): Promise<{ id: string; account_id: string; config: any } | null> {
  const { data } = await admin
    .from("channels")
    .select("id, account_id, config")
    .eq("channel_type", "whatsapp")
    .filter("config->>phone_number_id", "eq", phoneNumberId)
    .maybeSingle();
  return data ?? null;
}

export async function loadMessengerConfig(
  admin: SupabaseClient,
  channelId: string,
): Promise<MessengerConfig> {
  const { data, error } = await admin
    .from("channels")
    .select("id, account_id, channel_type, config, enabled")
    .eq("id", channelId)
    .maybeSingle();
  if (error) throw new ChannelConfigError(`channel lookup failed: ${error.message}`, 500);
  if (!data) throw new ChannelConfigError("channel not found", 404);
  if (data.channel_type !== "messenger") throw new ChannelConfigError("channel is not messenger", 400);
  if (!data.enabled) throw new ChannelConfigError("channel disabled", 409);

  const cfg = (data.config ?? {}) as Record<string, any>;
  const pageId = cfg.page_id;
  const accessToken = cfg.access_token ?? Deno.env.get("MESSENGER_PAGE_ACCESS_TOKEN");
  if (!pageId) throw new ChannelConfigError("page_id not configured", 409);
  if (!accessToken) throw new ChannelConfigError("access_token not configured", 409);

  return {
    channelId: data.id,
    accountId: data.account_id,
    pageId,
    accessToken,
  };
}

export async function findMessengerChannelByPageId(
  admin: SupabaseClient,
  pageId: string,
): Promise<{ id: string; account_id: string; config: any } | null> {
  const { data } = await admin
    .from("channels")
    .select("id, account_id, config")
    .eq("channel_type", "messenger")
    .filter("config->>page_id", "eq", pageId)
    .maybeSingle();
  return data ?? null;
}
