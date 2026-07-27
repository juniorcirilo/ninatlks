// Client-side helpers to manage per-account API keys stored in Vault.
// Backed by the SECURITY DEFINER RPCs created in the Vault migration.
//
// Usage:
//   await setAccountSecret(accountId, "elevenlabs", "api_key", "sk_...")
//   const list = await listAccountSecrets(accountId)  // metadata only
//   await deleteAccountSecret(accountId, "elevenlabs", "api_key")
//
// Secret VALUES are never returned to the browser — only the backend can
// read them.

import { apiClient } from "@/lib/api-client";

export type SecretProvider =
  | "twilio"
  | "elevenlabs"
  | "deepgram"
  | "evolution"
  | "zernio"
  | "meta";

export interface AccountSecretEntry {
  provider: SecretProvider;
  key_name: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function setAccountSecret(
  accountId: string,
  provider: SecretProvider,
  keyName: string,
  value: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await apiClient.post(`/accounts/${accountId}/secrets`, {
    provider,
    keyName,
    value,
    metadata,
  });
}

export async function deleteAccountSecret(
  accountId: string,
  provider: SecretProvider,
  keyName: string,
): Promise<boolean> {
  return apiClient.delete<boolean>(
    `/accounts/${accountId}/secrets/${provider}/${keyName}`,
  );
}

export async function listAccountSecrets(
  accountId: string,
): Promise<AccountSecretEntry[]> {
  return apiClient.get<AccountSecretEntry[]>(`/accounts/${accountId}/secrets`);
}

/**
 * Bulk-set helper for the onboarding wizard: persists multiple keys for the
 * same provider in parallel and returns when all writes complete.
 */
export async function setAccountSecretsBulk(
  accountId: string,
  provider: SecretProvider,
  keys: Record<string, string>,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const entries = Object.entries(keys).filter(([, v]) => typeof v === "string" && v.length > 0);
  await Promise.all(
    entries.map(([keyName, value]) =>
      setAccountSecret(accountId, provider, keyName, value, metadata),
    ),
  );
}

/**
 * Convenience: returns a Set of "provider:key_name" pairs that are configured.
 * Useful to render ✓/✗ in the onboarding checklist.
 */
export async function configuredKeysSet(accountId: string): Promise<Set<string>> {
  const list = await listAccountSecrets(accountId);
  return new Set(list.map((e) => `${e.provider}:${e.key_name}`));
}
