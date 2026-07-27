// Number provisioning — search available + buy.
// Reference:
//   https://www.twilio.com/docs/phone-numbers/api/availablephonenumber-resource
//   https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource

import { twilioRequest } from "./client.ts";
import type { TwilioCredentials } from "./client.ts";

export interface AvailableNumberQuery {
  countryCode: string;                  // ISO-3166 (BR, US, MX…)
  type?: "Local" | "TollFree" | "Mobile";
  areaCode?: string;
  contains?: string;                    // pattern like 555*
  smsEnabled?: boolean;
  mmsEnabled?: boolean;
  voiceEnabled?: boolean;
  limit?: number;
}

export interface AvailableNumberRow {
  phoneNumber: string;
  friendlyName?: string;
  locality?: string;
  region?: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
  beta?: boolean;
}

export async function searchAvailableNumbers(
  credentials: TwilioCredentials,
  q: AvailableNumberQuery,
): Promise<AvailableNumberRow[]> {
  const type = q.type ?? "Local";
  const resp = await twilioRequest<any>({
    method: "GET",
    path: `/2010-04-01/Accounts/${credentials.accountSid}/AvailablePhoneNumbers/${q.countryCode}/${type}.json`,
    credentials,
    query: {
      AreaCode: q.areaCode,
      Contains: q.contains,
      SmsEnabled: q.smsEnabled,
      MmsEnabled: q.mmsEnabled,
      VoiceEnabled: q.voiceEnabled,
      PageSize: q.limit ?? 20,
    },
  });
  const list = resp.available_phone_numbers ?? [];
  return list.map((n: any) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality,
    region: n.region,
    capabilities: {
      voice: !!n.capabilities?.voice,
      sms: !!(n.capabilities?.SMS ?? n.capabilities?.sms),
      mms: !!(n.capabilities?.MMS ?? n.capabilities?.mms),
      fax: !!n.capabilities?.fax,
    },
    beta: n.beta,
  }));
}

export interface BuyNumberInput {
  phoneNumber?: string;                 // exact
  areaCode?: string;                    // or random within area code
  friendlyName?: string;
  smsUrl?: string;
  voiceUrl?: string;
  voiceMethod?: "GET" | "POST";
  smsMethod?: "GET" | "POST";
  statusCallback?: string;
  messagingServiceSid?: string;
  bundleSid?: string;                   // regulatory bundle (for BR etc.)
  addressSid?: string;
  emergencyStatus?: "Active" | "Inactive";
}

export interface BoughtNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  raw: any;
}

export async function buyNumber(
  credentials: TwilioCredentials,
  input: BuyNumberInput,
): Promise<BoughtNumber> {
  const form: Record<string, any> = {};
  if (input.phoneNumber) form.PhoneNumber = input.phoneNumber;
  else if (input.areaCode) form.AreaCode = input.areaCode;
  else throw new Error("phoneNumber or areaCode required");

  if (input.friendlyName) form.FriendlyName = input.friendlyName;
  if (input.smsUrl) form.SmsUrl = input.smsUrl;
  if (input.smsMethod) form.SmsMethod = input.smsMethod;
  if (input.voiceUrl) form.VoiceUrl = input.voiceUrl;
  if (input.voiceMethod) form.VoiceMethod = input.voiceMethod;
  if (input.statusCallback) form.StatusCallback = input.statusCallback;
  if (input.messagingServiceSid) form.MessagingServiceSid = input.messagingServiceSid;
  if (input.bundleSid) form.BundleSid = input.bundleSid;
  if (input.addressSid) form.AddressSid = input.addressSid;
  if (input.emergencyStatus) form.EmergencyStatus = input.emergencyStatus;

  const resp = await twilioRequest<any>({
    method: "POST",
    path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
    credentials,
    form,
  });

  return {
    sid: resp.sid,
    phoneNumber: resp.phone_number,
    friendlyName: resp.friendly_name,
    capabilities: {
      voice: !!resp.capabilities?.voice,
      sms: !!resp.capabilities?.sms,
      mms: !!resp.capabilities?.mms,
    },
    raw: resp,
  };
}

/**
 * Update the webhooks on an already-owned IncomingPhoneNumber (SID required).
 * Useful to point a number's voice/SMS URLs to Nexus after buy.
 */
export async function configureNumber(
  credentials: TwilioCredentials,
  twilioSid: string,
  updates: Partial<BuyNumberInput>,
): Promise<{ raw: any }> {
  const form: Record<string, any> = {};
  if (updates.friendlyName) form.FriendlyName = updates.friendlyName;
  if (updates.smsUrl) form.SmsUrl = updates.smsUrl;
  if (updates.smsMethod) form.SmsMethod = updates.smsMethod;
  if (updates.voiceUrl) form.VoiceUrl = updates.voiceUrl;
  if (updates.voiceMethod) form.VoiceMethod = updates.voiceMethod;
  if (updates.statusCallback) form.StatusCallback = updates.statusCallback;
  if (updates.messagingServiceSid) form.MessagingServiceSid = updates.messagingServiceSid;

  const resp = await twilioRequest<any>({
    method: "POST",
    path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
    credentials,
    form,
  });
  return { raw: resp };
}

export async function releaseNumber(
  credentials: TwilioCredentials,
  twilioSid: string,
): Promise<void> {
  await twilioRequest({
    method: "DELETE",
    path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
    credentials,
  });
}
