import { DataSource } from 'typeorm';
import { TwilioCredentials } from './twilio-client.service';
import { TwilioConfigError } from './twilio-config.service';

/**
 * Non-request-scoped equivalent of TwilioConfigService.loadAccountCreds
 * (Scope.REQUEST, depends on SecretsService/TenantTxHost) — for webhook
 * handlers and BullMQ processors that don't carry a per-request DI subtree.
 * Goes through the `account_secret_resolve_bundle` SECURITY DEFINER wrapper
 * (see migrations/20260720190000-AccountSecretsResolveBypass.ts) — same
 * rationale as resolveElevenLabsApiKey in modules/voice/.
 */
export async function resolveTwilioCreds(
  dataSource: DataSource,
  accountId: string,
): Promise<TwilioCredentials> {
  const rows = await dataSource.query<
    { key_name: string; decrypted_secret: string }[]
  >(`SELECT key_name, decrypted_secret FROM public.account_secret_resolve_bundle($1, 'twilio')`, [
    accountId,
  ]);
  const bundle = Object.fromEntries(
    rows.map((r) => [r.key_name, r.decrypted_secret]),
  );

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
