// Twilio REST API client shared by every outbound call.
// Centralizes: URL building, Basic auth, form-encoding, error shape, and
// AsyncLocalStorage-based usage capture (mirrors the Meta client).
//
// All Twilio REST endpoints are form-urlencoded, not JSON.

import { AsyncLocalStorage } from "node:async_hooks";

const API_BASE = "https://api.twilio.com";
const LOOKUPS_BASE = "https://lookups.twilio.com";
const MESSAGING_BASE = "https://messaging.twilio.com";
const VOICE_BASE = "https://voice.twilio.com";
const INTELLIGENCE_BASE = "https://intelligence.twilio.com";

export interface TwilioCredentials {
  accountSid: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface TwilioRequest {
  method: "GET" | "POST" | "DELETE";
  path: string;               // e.g. "/2010-04-01/Accounts/AC.../Messages.json"
  credentials: TwilioCredentials;
  query?: Record<string, string | number | boolean | null | undefined>;
  form?: Record<string, string | number | boolean | null | undefined | string[]>;
  base?: "api" | "lookups" | "messaging" | "voice" | "intelligence";
}

export class TwilioError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly moreInfo?: string;
  readonly details: unknown;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = "TwilioError";
    this.status = status;
    this.code = details?.code;
    this.moreInfo = details?.more_info;
    this.details = details;
  }
}

interface UsageBucket {
  requests: Array<{ path: string; status: number; durationMs: number }>;
}
const usageStorage = new AsyncLocalStorage<UsageBucket>();

export async function withTwilioUsageCapture<T>(fn: () => Promise<T>): Promise<{
  result: T;
  usages: UsageBucket["requests"];
}> {
  const bucket: UsageBucket = { requests: [] };
  const result = await usageStorage.run(bucket, fn);
  return { result, usages: bucket.requests };
}

function baseUrlFor(kind: TwilioRequest["base"]): string {
  switch (kind) {
    case "lookups":
      return LOOKUPS_BASE;
    case "messaging":
      return MESSAGING_BASE;
    case "voice":
      return VOICE_BASE;
    case "intelligence":
      return INTELLIGENCE_BASE;
    case "api":
    default:
      return API_BASE;
  }
}

function authHeader(c: TwilioCredentials): string {
  // Prefer API Key + Secret when provided (recommended for server-to-server).
  const user = c.apiKey ?? c.accountSid;
  const pass = c.apiSecret ?? c.authToken ?? "";
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

function buildFormBody(form: TwilioRequest["form"]): URLSearchParams {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form ?? {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) body.append(k, String(item));
    } else {
      body.append(k, String(v));
    }
  }
  return body;
}

function buildQuery(q: TwilioRequest["query"]): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function twilioRequest<T = any>(req: TwilioRequest): Promise<T> {
  const started = Date.now();
  const base = baseUrlFor(req.base);
  const url = `${base}${req.path}${buildQuery(req.query)}`;
  const headers: Record<string, string> = {
    Authorization: authHeader(req.credentials),
    Accept: "application/json",
  };
  const init: RequestInit = { method: req.method, headers };
  if (req.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = buildFormBody(req.form).toString();
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { _raw: text };
  }

  const bucket = usageStorage.getStore();
  if (bucket) {
    bucket.requests.push({
      path: req.path,
      status: res.status,
      durationMs: Date.now() - started,
    });
  }

  if (!res.ok) {
    const msg = parsed?.message ?? parsed?.detail ?? `Twilio ${res.status}`;
    throw new TwilioError(res.status, msg, parsed);
  }
  return parsed as T;
}

/** Twilio numbers need E.164; we accept both "+5511…" and "5511…" input. */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}
