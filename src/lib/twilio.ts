import { apiClient } from "@/lib/api-client";

export interface OwnedTwilioNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
  already_imported: boolean;
}

/** Lists numbers already purchased on the connected Twilio account. */
export async function fetchOwnedTwilioNumbers(accountId: string): Promise<OwnedTwilioNumber[]> {
  return apiClient.get<OwnedTwilioNumber[]>(`/accounts/${accountId}/twilio/numbers/owned`);
}

/**
 * Import an EXISTING Twilio number into Nina Talks (e.g. trial account's free
 * number, or a pre-existing one on the account). Skips the purchase call —
 * only re-points the voice/sms webhooks and registers the phone_numbers row.
 */
export async function importTwilioNumber(args: {
  accountId: string;
  phoneNumber: string;
  pinnedPersonaId?: string | null;
  inboxId?: string | null;
  inboundBehavior?: "ai_answer" | "forward_to_agent" | "voicemail" | "suggest";
}) {
  return apiClient.post<{
    phone_number: { id: string; e164: string };
    twilio: { sid: string; phone_number: string; friendly_name: string };
  }>(`/accounts/${args.accountId}/twilio/numbers/import`, {
    phoneNumber: args.phoneNumber,
    pinnedPersonaId: args.pinnedPersonaId ?? null,
    inboxId: args.inboxId ?? null,
    inboundBehavior: args.inboundBehavior ?? "ai_answer",
  });
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName?: string;
  locality?: string;
  region?: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

export async function searchAvailableNumbers(params: {
  countryCode: string;
  type?: "Local" | "TollFree" | "Mobile";
  areaCode?: string;
  contains?: string;
  voice?: boolean;
  sms?: boolean;
  mms?: boolean;
  accountId: string;
}): Promise<AvailableNumber[]> {
  const query = new URLSearchParams();
  query.set("countryCode", params.countryCode);
  if (params.type) query.set("type", params.type);
  if (params.areaCode) query.set("areaCode", params.areaCode);
  if (params.contains) query.set("contains", params.contains);
  if (params.voice !== undefined) query.set("voice", String(params.voice));
  if (params.sms !== undefined) query.set("sms", String(params.sms));
  if (params.mms !== undefined) query.set("mms", String(params.mms));
  return apiClient.get<AvailableNumber[]>(
    `/accounts/${params.accountId}/twilio/numbers/search?${query.toString()}`,
  );
}

export async function buyNumber(params: {
  accountId: string;
  phoneNumber: string;
  friendlyName?: string;
  inboxId?: string | null;
  pinnedPersonaId?: string | null;
  inboundBehavior?: string;
  bundleSid?: string;
  addressSid?: string;
}): Promise<{ phone_number: any; twilio: any }> {
  return apiClient.post(`/accounts/${params.accountId}/twilio/numbers/buy`, {
    phoneNumber: params.phoneNumber,
    friendlyName: params.friendlyName,
    inboxId: params.inboxId,
    pinnedPersonaId: params.pinnedPersonaId,
    inboundBehavior: params.inboundBehavior,
    bundleSid: params.bundleSid,
    addressSid: params.addressSid,
  });
}

export async function retryTranscription(accountId: string, voiceCallId: string) {
  return apiClient.post<{ ok: boolean; skipped?: boolean; utterances?: number; error?: string }>(
    `/accounts/${accountId}/voice/calls/${voiceCallId}/transcribe`,
    {},
  );
}
