import { apiClient } from "@/lib/api-client";

export interface ProviderReport {
  key: "elevenlabs" | "twilio" | "evolution" | "deepgram" | "n8n" | "google_calendar" | "smtp";
  label: string;
  configured: boolean;
  ok: boolean | null;
  detail?: string;
  usage?: Record<string, string | number | null>;
  /** true quando a credencial vem fixada por variável de ambiente do servidor — a tela não oferece editar. */
  locked?: boolean;
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

export async function fetchIntegrationsStatus(
  accountId: string,
  opts: { ttlMs?: number; force?: boolean } = {},
): Promise<IntegrationsStatusReport> {
  const ttlMs = opts.ttlMs ?? 2 * 60_000;
  const now = Date.now();
  const current = cache.get(accountId);

  if (!opts.force && current?.data && current.expiresAt > now) return current.data;
  if (!opts.force && current?.promise) return current.promise;

  const promise = apiClient
    .post<IntegrationsStatusReport>(`/accounts/${accountId}/integrations-status`)
    .then((report) => {
      cache.set(accountId, { data: report, expiresAt: Date.now() + ttlMs });
      return report;
    })
    .catch((error: unknown) => {
      if (current?.data) cache.set(accountId, current);
      else cache.delete(accountId);
      throw error;
    });

  cache.set(accountId, { data: current?.data, promise, expiresAt: now + ttlMs });
  return promise;
}
