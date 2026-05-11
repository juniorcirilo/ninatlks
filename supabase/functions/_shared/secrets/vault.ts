// ============================================================================
// Per-account secret resolver with cache.
//
// Resolution chain (highest priority first):
//   1. Vault (account_secrets via get_account_secret RPC)
//   2. Channel/phone_number config column (caller-provided)
//   3. Global Deno env var (caller-provided)
//
// Edge functions should call `resolveSecret` instead of touching env directly
// for any provider that supports per-tenant credentials (ElevenLabs, Deepgram,
// Twilio, Evolution, Zernio).
// ============================================================================

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

export type SecretProvider =
  | "twilio"
  | "elevenlabs"
  | "deepgram"
  | "evolution"
  | "zernio"
  | "meta";

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute — keeps webhook bursts fast without losing rotation freshness
const cache = new Map<string, CacheEntry>();

function cacheKey(accountId: string, provider: SecretProvider, keyName: string) {
  return `${accountId}::${provider}::${keyName}`;
}

export interface ResolveSecretOptions {
  accountId?: string | null;
  provider: SecretProvider;
  keyName: string;
  /** Inline value already loaded from the caller's `config`/`provider_config` */
  configValue?: string | null;
  /** Name of the global env var to fall back on */
  envVar?: string;
  /** Disable cache (e.g., for validation right after a write) */
  noCache?: boolean;
}

/**
 * Resolve a single secret using Vault → channel config → env fallback.
 * Returns `null` if no source has a value.
 */
export async function resolveSecret(
  admin: SupabaseClient,
  opts: ResolveSecretOptions,
): Promise<string | null> {
  const { accountId, provider, keyName, configValue, envVar, noCache } = opts;

  // 1. Vault — only when we have an account_id
  if (accountId) {
    const key = cacheKey(accountId, provider, keyName);
    const now = Date.now();

    if (!noCache) {
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) {
        if (hit.value) return hit.value;
        // negative cache hit — fall through to other sources
      }
    }

    let vaultRpcSucceeded = false;
    try {
      const { data, error } = await admin.rpc("get_account_secret", {
        p_account_id: accountId,
        p_provider: provider,
        p_key_name: keyName,
      });
      if (error) {
        console.error(
          `[vault] get_account_secret failed for ${provider}/${keyName} (account ${accountId}):`,
          error.message ?? error,
        );
      } else {
        vaultRpcSucceeded = true;
        if (typeof data === "string" && data.length > 0) {
          cache.set(key, { value: data, expiresAt: now + CACHE_TTL_MS });
          console.log(
            `[vault] resolved ${provider}/${keyName} from account vault (len=${data.length})`,
          );
          return data;
        }
        // Cache the miss too so we don't hammer the RPC during webhook storms
        cache.set(key, { value: null, expiresAt: now + CACHE_TTL_MS });
        console.log(
          `[vault] no ${provider}/${keyName} in vault for account ${accountId}`,
        );
      }
    } catch (err) {
      console.error(
        `[vault] get_account_secret threw for ${provider}/${keyName}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // If we have an account context AND the RPC succeeded but returned no
    // value, do NOT fall back to env var — that would mask a missing key
    // with an unrelated global credential. Only fall through to env when
    // the RPC itself failed (vault disabled / RPC missing) so dev setups
    // without Vault still work.
    if (vaultRpcSucceeded) {
      if (configValue && configValue.length > 0) return configValue;
      return null;
    }
  }

  // 2. Channel / provider_config inline value
  if (configValue && configValue.length > 0) return configValue;

  // 3. Global env var
  if (envVar) {
    const v = Deno.env.get(envVar);
    if (v && v.length > 0) return v;
  }

  return null;
}

/**
 * Resolve multiple keys for the same provider in one RPC call.
 * Returns an object keyed by `keyName` containing the resolved values
 * (or null when a key has no value anywhere).
 */
export async function resolveSecretsBulk(
  admin: SupabaseClient,
  opts: {
    accountId?: string | null;
    provider: SecretProvider;
    keys: Array<{ keyName: string; configValue?: string | null; envVar?: string }>;
    noCache?: boolean;
  },
): Promise<Record<string, string | null>> {
  const { accountId, provider, keys, noCache } = opts;
  const out: Record<string, string | null> = {};
  let vaultBundle: Record<string, string> | null = null;
  let vaultRpcSucceeded = false;

  if (accountId) {
    try {
      const { data, error } = await admin.rpc("get_account_secrets_bulk", {
        p_account_id: accountId,
        p_provider: provider,
      });
      if (error) {
        console.error(
          `[vault] get_account_secrets_bulk failed for ${provider}:`,
          error.message ?? error,
        );
      } else {
        vaultRpcSucceeded = true;
        if (data && typeof data === "object") {
          vaultBundle = data as Record<string, string>;
        } else {
          vaultBundle = {};
        }
      }
    } catch (err) {
      console.error(
        `[vault] get_account_secrets_bulk threw for ${provider}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  for (const k of keys) {
    const fromVault = vaultBundle?.[k.keyName];
    if (typeof fromVault === "string" && fromVault.length > 0) {
      out[k.keyName] = fromVault;
      // Warm the per-key cache too
      if (accountId) {
        cache.set(cacheKey(accountId, provider, k.keyName), {
          value: fromVault,
          expiresAt: Date.now() + CACHE_TTL_MS,
        });
      }
      continue;
    }
    // When the Vault RPC succeeded but didn't have this key, prefer
    // configValue but never fall back to a global env var — that would
    // mask a missing per-account secret with an unrelated credential.
    if (accountId && vaultRpcSucceeded) {
      out[k.keyName] = k.configValue && k.configValue.length > 0 ? k.configValue : null;
      continue;
    }
    if (k.configValue && k.configValue.length > 0) {
      out[k.keyName] = k.configValue;
      continue;
    }
    if (k.envVar) {
      const v = Deno.env.get(k.envVar);
      out[k.keyName] = v && v.length > 0 ? v : null;
      continue;
    }
    out[k.keyName] = null;
  }

  if (!noCache) return out;
  // If noCache, evict touched entries so the next read goes back to Vault
  if (accountId) {
    for (const k of keys) cache.delete(cacheKey(accountId, provider, k.keyName));
  }
  return out;
}

/** Manually evict cache entries — call after `set_account_secret`. */
export function invalidateSecretCache(
  accountId: string,
  provider: SecretProvider,
  keyName?: string,
) {
  if (keyName) {
    cache.delete(cacheKey(accountId, provider, keyName));
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(`${accountId}::${provider}::`)) cache.delete(k);
  }
}
