import { DataSource } from 'typeorm';

/**
 * Non-request-scoped equivalent of ElevenLabsConfigService.loadAccountCreds
 * (which depends on the Scope.REQUEST SecretsService/TenantTxHost chain, so
 * it can't be injected into BullMQ processors or webhook handlers that don't
 * carry a per-request DI subtree). Goes through the
 * `account_secret_resolve_bundle` SECURITY DEFINER wrapper (see
 * migrations/20260720190000-AccountSecretsResolveBypass.ts) since the plain
 * DataSource pool has no session vars — a raw query against
 * `account_secrets` would silently return zero rows under real RLS.
 */
export async function resolveElevenLabsApiKey(
  dataSource: DataSource,
  accountId: string,
): Promise<string | null> {
  const rows = await dataSource.query<{ decrypted_secret: string }[]>(
    `SELECT decrypted_secret FROM public.account_secret_resolve_bundle($1, 'elevenlabs') WHERE key_name = 'api_key'`,
    [accountId],
  );
  return rows[0]?.decrypted_secret || process.env.ELEVENLABS_API_KEY || null;
}
