import { Injectable, Scope } from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';
import { TwilioCredentials } from './twilio-client.service';

export class TwilioConfigError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TwilioConfigError';
    this.status = status;
  }
}

/**
 * Ported from supabase/functions/_shared/twilio/config.ts's
 * loadAccountTwilioCreds — resolution order: account vault → env var
 * fallback (dev only). Per-channel/phone_number config-column overrides
 * from the original aren't ported (no callers left once channels/SMS
 * dispatch is out of scope here).
 */
@Injectable({ scope: Scope.REQUEST })
export class TwilioConfigService {
  constructor(private readonly secrets: SecretsService) {}

  async loadAccountCreds(accountId: string): Promise<TwilioCredentials> {
    const bundle = await this.secrets.getInternalBulk(accountId, 'twilio');

    const sid = bundle.account_sid || process.env.TWILIO_ACCOUNT_SID || '';
    if (!sid) {
      throw new TwilioConfigError(
        'Credenciais Twilio não configuradas. Vá em Configurações → Integrações → Twilio e cadastre Account SID + Auth Token.',
        409,
      );
    }
    const authToken =
      bundle.auth_token || process.env.TWILIO_AUTH_TOKEN || undefined;
    const apiKey = bundle.api_key || process.env.TWILIO_API_KEY || undefined;
    const apiSecret =
      bundle.api_secret || process.env.TWILIO_API_SECRET || undefined;

    if (!authToken && (!apiKey || !apiSecret)) {
      throw new TwilioConfigError(
        'Auth Token (ou API Key + API Secret) Twilio ausente. Atualize em Configurações → Integrações.',
        409,
      );
    }

    return { accountSid: sid, authToken, apiKey, apiSecret };
  }
}
