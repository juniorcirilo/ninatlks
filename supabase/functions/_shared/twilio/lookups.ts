// Twilio Lookups v2 — validate E.164 and enrich with line type / carrier.
// Reference: https://www.twilio.com/docs/lookup/v2-api

import { twilioRequest } from "./client.ts";
import type { TwilioCredentials } from "./client.ts";

export interface LookupResult {
  valid: boolean;
  phoneNumber: string;
  countryCode?: string;
  nationalFormat?: string;
  lineType?: "mobile" | "landline" | "voip" | "fixedVoip" | "nonFixedVoip" | "unknown" | null;
  carrier?: { name: string; mobileNetworkCode?: string; mobileCountryCode?: string };
  callerName?: string | null;
  sms_pumping_risk_score?: number | null;
  raw: any;
}

export async function lookupNumber(
  credentials: TwilioCredentials,
  phone: string,
  opts: { fields?: Array<"line_type_intelligence" | "caller_name" | "sms_pumping_risk" | "identity_match">; countryCode?: string } = {},
): Promise<LookupResult> {
  const fields = opts.fields?.join(",") ?? "line_type_intelligence";
  const path = `/v2/PhoneNumbers/${encodeURIComponent(phone)}`;
  const resp = await twilioRequest<any>({
    method: "GET",
    path,
    credentials,
    query: { Fields: fields, CountryCode: opts.countryCode },
    base: "lookups",
  });

  return {
    valid: resp.valid ?? false,
    phoneNumber: resp.phone_number,
    countryCode: resp.country_code,
    nationalFormat: resp.national_format,
    lineType: resp.line_type_intelligence?.type,
    carrier: resp.line_type_intelligence?.carrier_name
      ? {
          name: resp.line_type_intelligence.carrier_name,
          mobileNetworkCode: resp.line_type_intelligence.mobile_network_code,
          mobileCountryCode: resp.line_type_intelligence.mobile_country_code,
        }
      : undefined,
    callerName: resp.caller_name?.caller_name ?? null,
    sms_pumping_risk_score: resp.sms_pumping_risk?.sms_pumping_risk_score ?? null,
    raw: resp,
  };
}
