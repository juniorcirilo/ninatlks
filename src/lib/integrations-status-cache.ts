import { supabase } from "@/integrations/supabase/client";

export interface ProviderReport {
  key: "elevenlabs" | "twilio" | "evolution" | "deepgram";
  label: string;
  configured: boolean;
  ok: boolean | null;
  detail?: string;
  usage?: Record<string, string | number | null>;
}

export interface NexusReport {
  agents_total: number;
  agents_synced_to_el: number;
  numbers_total: number;
  numbers_ai_active: number;
  numbers_pinned: number;
}

export interface IntegrationsStatusReport {
  ok?: boolean;
  providers: ProviderReport[];
  nexus: NexusReport;
}

type CacheEntry = {
  expiresAt: number;
  promise?: Promise<IntegrationsStatusReport>;
  data?: IntegrationsStatusReport;
};

const cache = new Map<string, CacheEntry>();

const INTEGRATIONS_TIMEOUT_MS = 8_000;

async function invokeWithTimeout<T>(
  functionName: string,
  body: unknown,
  timeoutMs = INTEGRATIONS_TIMEOUT_MS,
): Promise<T> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : null) ?? `HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("timeout");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function fetchIntegrationsStatus(
  accountId: string,
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<IntegrationsStatusReport> {
  const ttlMs = opts.ttlMs ?? 2 * 60_000;
  const now = Date.now();
  const current = cache.get(accountId);

  if (!opts.force && current?.data && current.expiresAt > now) return current.data;
  if (!opts.force && current?.promise) return current.promise;

  const promise = invokeWithTimeout<IntegrationsStatusReport>(
    "integrations-status",
    { account_id: accountId },
  )
    .then((report) => {
      cache.set(accountId, { data: report, expiresAt: Date.now() + ttlMs });
      return report;
    })
    .catch((error) => {
      if (current?.data) cache.set(accountId, current);
      else cache.delete(accountId);
      throw error;
    });

  cache.set(accountId, { data: current?.data, promise, expiresAt: now + ttlMs });
  return promise;
}