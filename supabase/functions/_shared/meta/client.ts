// Graph API HTTP client shared by every Meta outbound call.
// Encapsulates: versioning, auth header, JSON serialization, error shape,
// plus an AsyncLocalStorage-based usage collector so callers can capture
// all rate-limit headers produced during a batch of requests without
// threading extra return values through every helper.

import { AsyncLocalStorage } from "node:async_hooks";

// Default Graph API version. Bumped from v22.0 → v23.0 after review:
// Meta's own current documentation examples default to v23.0+, and v23.0
// keeps us on a version with ≥18 months of support runway. Override via
// META_API_VERSION env var when a specific app is pinned to another version.
const DEFAULT_API_VERSION = "v23.0";
const DEFAULT_BASE = "https://graph.facebook.com";

export interface GraphRequest {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  accessToken: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  formData?: FormData;
  apiVersion?: string;
  // When truthy, skip the API version prefix (for already-versioned paths).
  raw?: boolean;
}

export interface GraphUsageSnapshot {
  businessUseCase?: string;
  pagePolicyCalls?: string;
  appUsage?: string;
}

export interface GraphResponse<T = any> {
  data: T;
  usage: GraphUsageSnapshot;
  status: number;
}

export class GraphError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly isRateLimit: boolean;
  readonly isAuth: boolean;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "GraphError";
    this.status = status;
    this.details = details;
    this.isRateLimit = status === 429 || (details as any)?.error?.code === 80007;
    this.isAuth = status === 401 || status === 403;
  }
}

// ─────────────────────────────────────────────────────────────
// Usage capture — async-local bucket filled by every graphRequest
// ─────────────────────────────────────────────────────────────
interface UsageBucket {
  usages: GraphUsageSnapshot[];
}
const usageStorage = new AsyncLocalStorage<UsageBucket>();

/**
 * Run `fn` inside a usage-capture scope. Every graphRequest issued
 * (directly or transitively) during `fn()` will push its usage snapshot
 * into the returned array.
 *
 * Usage:
 *   const { result, usages } = await withUsageCapture(() => whatsapp.sendText(cfg, {...}));
 */
export async function withUsageCapture<T>(fn: () => Promise<T>): Promise<{ result: T; usages: GraphUsageSnapshot[] }> {
  const bucket: UsageBucket = { usages: [] };
  const result = await usageStorage.run(bucket, fn);
  return { result, usages: bucket.usages };
}

export async function graphRequest<T = any>(req: GraphRequest): Promise<GraphResponse<T>> {
  const version = req.raw ? "" : req.apiVersion ?? Deno.env.get("META_API_VERSION") ?? DEFAULT_API_VERSION;
  const base = Deno.env.get("META_BASE_URL") ?? DEFAULT_BASE;
  const qs = buildQuery(req.query);
  const prefix = req.raw ? "" : `/${version}`;
  const url = `${base}${prefix}${ensureLeadingSlash(req.path)}${qs}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${req.accessToken}`,
  };
  if (req.body && !req.formData) headers["Content-Type"] = "application/json";

  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.formData
      ? (req.formData as any)
      : req.body
        ? JSON.stringify(req.body)
        : undefined,
  };

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { _raw: text };
  }

  if (!res.ok) {
    const message = parsed?.error?.message ?? parsed?.error_description ?? `Graph ${res.status}`;
    throw new GraphError(res.status, message, parsed);
  }

  const usage: GraphUsageSnapshot = {
    businessUseCase: res.headers.get("x-business-use-case-usage") ?? undefined,
    pagePolicyCalls: res.headers.get("x-page-usage") ?? undefined,
    appUsage: res.headers.get("x-app-usage") ?? undefined,
  };

  // Emit into ambient usage bucket (if a withUsageCapture scope is active).
  const bucket = usageStorage.getStore();
  if (bucket) bucket.usages.push(usage);

  return { data: parsed, status: res.status, usage };
}

/**
 * Persist usage metrics captured from a GraphResponse into `channel_usage_metrics`
 * via RPC. Called fire-and-forget after dispatch so we don't slow down sends.
 *
 * Accepts any SupabaseClient-shaped object; passing `null` no-ops.
 */
export async function recordUsage(params: {
  admin: { rpc: (name: string, args: Record<string, unknown>) => any } | null;
  accountId: string;
  channelId: string | null;
  productKind: "whatsapp" | "messenger" | "instagram";
  usage: GraphResponse["usage"];
}): Promise<void> {
  if (!params.admin) return;
  const raw = {
    business_use_case: safeJson(params.usage.businessUseCase),
    page_usage: safeJson(params.usage.pagePolicyCalls),
    app_usage: safeJson(params.usage.appUsage),
  };
  const bucUsage = raw.business_use_case ?? {};
  // Meta returns { "<id>": [ { call_count, total_cputime, total_time } ] }
  // We pick the max across ids to keep the signal simple.
  let totalTime = 0;
  let totalCpu = 0;
  let callVolume = 0;
  for (const arr of Object.values(bucUsage)) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr as any[]) {
      totalTime = Math.max(totalTime, entry?.total_time ?? 0);
      totalCpu = Math.max(totalCpu, entry?.total_cputime ?? 0);
      callVolume = Math.max(callVolume, entry?.call_count ?? 0);
    }
  }
  try {
    await params.admin.rpc("record_channel_usage", {
      p_account_id: params.accountId,
      p_channel_id: params.channelId,
      p_product_kind: params.productKind,
      p_total_time_pct: totalTime || null,
      p_total_cputime_pct: totalCpu || null,
      p_call_volume_pct: callVolume || null,
      p_raw: raw,
    });
  } catch (err) {
    console.warn("[meta/client] recordUsage failed", err);
  }
}

function safeJson(s: string | undefined): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function buildQuery(query?: GraphRequest["query"]): string {
  if (!query) return "";
  const entries = Object.entries(query).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, String(v));
  return `?${qs.toString()}`;
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
