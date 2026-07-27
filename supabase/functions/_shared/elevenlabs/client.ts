// ElevenLabs REST client shared across edge functions.
// Auth: xi-api-key header. Errors bubble up with status + parsed body.

const BASE = "https://api.elevenlabs.io";

export interface ElevenLabsCredentials {
  apiKey: string;
}

export class ElevenLabsError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
    this.details = details;
  }
}

export interface ElevenRequest {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  credentials: ElevenLabsCredentials;
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  /** Multipart form data (for voice clone upload). */
  form?: FormData;
  /** When set, returns the raw Response for streaming/binary consumers. */
  raw?: boolean;
}

function buildQuery(q: ElevenRequest["query"]): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function elevenRequest<T = any>(req: ElevenRequest): Promise<T> {
  const url = `${BASE}${req.path}${buildQuery(req.query)}`;
  const headers: Record<string, string> = {
    "xi-api-key": req.credentials.apiKey,
    Accept: "application/json",
  };
  const init: RequestInit = { method: req.method, headers };
  if (req.json) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(req.json);
  } else if (req.form) {
    init.body = req.form as any;
  }

  const res = await fetch(url, init);
  if (req.raw) return res as unknown as T;

  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { _raw: text };
  }
  if (!res.ok) {
    const msg = parsed?.detail?.message ?? parsed?.detail ?? parsed?.message ?? `ElevenLabs ${res.status}`;
    throw new ElevenLabsError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg), parsed);
  }
  return parsed as T;
}

/**
 * Sync resolver — env var only. Use for legacy callers that don't have an
 * account context (cron, global health checks).
 */
export function resolveCredentials(explicit?: string): ElevenLabsCredentials {
  const key = explicit ?? Deno.env.get("ELEVENLABS_API_KEY") ?? "";
  if (!key) throw new ElevenLabsError(503, "ELEVENLABS_API_KEY not configured");
  return { apiKey: key };
}

/**
 * Per-account resolver: Vault → explicit → env.
 * Pass the admin client and the account_id whenever available.
 */
export async function resolveCredentialsForAccount(
  admin: import("https://esm.sh/@supabase/supabase-js@2.74.0").SupabaseClient,
  accountId: string | null | undefined,
  explicit?: string,
): Promise<ElevenLabsCredentials> {
  const { resolveSecret } = await import("../secrets/vault.ts");
  const key = await resolveSecret(admin, {
    accountId,
    provider: "elevenlabs",
    keyName: "api_key",
    configValue: explicit ?? null,
    envVar: "ELEVENLABS_API_KEY",
  });
  if (!key) throw new ElevenLabsError(503, "ELEVENLABS_API_KEY not configured for this account");
  return { apiKey: key };
}
