import { Injectable } from '@nestjs/common';
import {
  TwilioClientService,
  TwilioCredentials,
} from './twilio-client.service';

export interface AvailableNumberQuery {
  countryCode: string;
  type?: 'Local' | 'TollFree' | 'Mobile';
  areaCode?: string;
  contains?: string;
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

export interface BuyNumberInput {
  phoneNumber?: string;
  areaCode?: string;
  friendlyName?: string;
  smsUrl?: string;
  voiceUrl?: string;
  voiceMethod?: 'GET' | 'POST';
  smsMethod?: 'GET' | 'POST';
  statusCallback?: string;
  bundleSid?: string;
  addressSid?: string;
}

export interface BoughtNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  raw: Record<string, unknown>;
}

export interface TwilioApiNumber {
  phone_number: string;
  friendly_name?: string;
  locality?: string;
  region?: string;
  sid: string;
  capabilities?: Record<string, boolean>;
  beta?: boolean;
}

/** Ported from supabase/functions/_shared/twilio/numbers.ts. */
@Injectable()
export class TwilioNumbersService {
  constructor(private readonly client: TwilioClientService) {}

  async searchAvailableNumbers(
    credentials: TwilioCredentials,
    q: AvailableNumberQuery,
  ): Promise<AvailableNumberRow[]> {
    const type = q.type ?? 'Local';
    const resp = await this.client.request<{
      available_phone_numbers: TwilioApiNumber[];
    }>({
      method: 'GET',
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
    return list.map((n) => ({
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

  async buyNumber(
    credentials: TwilioCredentials,
    input: BuyNumberInput,
  ): Promise<BoughtNumber> {
    const form: Record<string, string> = {};
    if (input.phoneNumber) form.PhoneNumber = input.phoneNumber;
    else if (input.areaCode) form.AreaCode = input.areaCode;
    else throw new Error('phoneNumber or areaCode required');

    if (input.friendlyName) form.FriendlyName = input.friendlyName;
    if (input.smsUrl) form.SmsUrl = input.smsUrl;
    if (input.smsMethod) form.SmsMethod = input.smsMethod;
    if (input.voiceUrl) form.VoiceUrl = input.voiceUrl;
    if (input.voiceMethod) form.VoiceMethod = input.voiceMethod;
    if (input.statusCallback) form.StatusCallback = input.statusCallback;
    if (input.bundleSid) form.BundleSid = input.bundleSid;
    if (input.addressSid) form.AddressSid = input.addressSid;

    const resp = await this.client.request<TwilioApiNumber>({
      method: 'POST',
      path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
      credentials,
      form,
    });

    return {
      sid: resp.sid,
      phoneNumber: resp.phone_number,
      friendlyName: resp.friendly_name ?? '',
      capabilities: {
        voice: !!resp.capabilities?.voice,
        sms: !!resp.capabilities?.sms,
        mms: !!resp.capabilities?.mms,
      },
      raw: resp as unknown as Record<string, unknown>,
    };
  }

  async releaseNumber(
    credentials: TwilioCredentials,
    twilioSid: string,
  ): Promise<void> {
    await this.client.request({
      method: 'DELETE',
      path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
      credentials,
    });
  }

  async listOwnedNumbers(
    credentials: TwilioCredentials,
  ): Promise<TwilioApiNumber[]> {
    const resp = await this.client.request<{
      incoming_phone_numbers: TwilioApiNumber[];
    }>({
      method: 'GET',
      path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
      credentials,
      query: { PageSize: 50 },
    });
    return resp.incoming_phone_numbers ?? [];
  }

  async findOwnedNumberByE164(
    credentials: TwilioCredentials,
    phoneNumber: string,
  ): Promise<TwilioApiNumber | null> {
    const resp = await this.client.request<{
      incoming_phone_numbers: TwilioApiNumber[];
    }>({
      method: 'GET',
      path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers.json`,
      credentials,
      query: { PhoneNumber: phoneNumber },
    });
    return resp.incoming_phone_numbers?.[0] ?? null;
  }

  async configureNumber(
    credentials: TwilioCredentials,
    twilioSid: string,
    updates: {
      voiceUrl?: string;
      voiceMethod?: string;
      smsUrl?: string;
      smsMethod?: string;
      statusCallback?: string;
    },
  ): Promise<TwilioApiNumber> {
    const form: Record<string, string> = {};
    if (updates.voiceUrl) form.VoiceUrl = updates.voiceUrl;
    if (updates.voiceMethod) form.VoiceMethod = updates.voiceMethod;
    if (updates.smsUrl) form.SmsUrl = updates.smsUrl;
    if (updates.smsMethod) form.SmsMethod = updates.smsMethod;
    if (updates.statusCallback) form.StatusCallback = updates.statusCallback;

    return this.client.request<TwilioApiNumber>({
      method: 'POST',
      path: `/2010-04-01/Accounts/${credentials.accountSid}/IncomingPhoneNumbers/${twilioSid}.json`,
      credentials,
      form,
    });
  }
}
