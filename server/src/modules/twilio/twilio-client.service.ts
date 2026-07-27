import { Injectable } from '@nestjs/common';

// Ported 1:1 from supabase/functions/_shared/twilio/client.ts — Twilio's
// REST API is entirely form-urlencoded (not JSON), Basic-auth'd with
// AccountSid:AuthToken (or ApiKey:ApiSecret).

const API_BASE = 'https://api.twilio.com';
const LOOKUPS_BASE = 'https://lookups.twilio.com';
const MESSAGING_BASE = 'https://messaging.twilio.com';
const VOICE_BASE = 'https://voice.twilio.com';
const INTELLIGENCE_BASE = 'https://intelligence.twilio.com';

export interface TwilioCredentials {
  accountSid: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface TwilioRequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  credentials: TwilioCredentials;
  query?: Record<string, string | number | boolean | null | undefined>;
  form?: Record<
    string,
    string | number | boolean | null | undefined | string[]
  >;
  base?: 'api' | 'lookups' | 'messaging' | 'voice' | 'intelligence';
}

export class TwilioError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly moreInfo?: string;
  readonly details: unknown;
  constructor(
    status: number,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TwilioError';
    this.status = status;
    this.code = details?.code as number | undefined;
    this.moreInfo = details?.more_info as string | undefined;
    this.details = details;
  }
}

function baseUrlFor(kind: TwilioRequestOptions['base']): string {
  switch (kind) {
    case 'lookups':
      return LOOKUPS_BASE;
    case 'messaging':
      return MESSAGING_BASE;
    case 'voice':
      return VOICE_BASE;
    case 'intelligence':
      return INTELLIGENCE_BASE;
    case 'api':
    default:
      return API_BASE;
  }
}

function authHeader(c: TwilioCredentials): string {
  const user = c.apiKey ?? c.accountSid;
  const pass = c.apiSecret ?? c.authToken ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function buildFormBody(form: TwilioRequestOptions['form']): URLSearchParams {
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

function buildQuery(q: TwilioRequestOptions['query']): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

@Injectable()
export class TwilioClientService {
  async request<T = unknown>(req: TwilioRequestOptions): Promise<T> {
    const base = baseUrlFor(req.base);
    const url = `${base}${req.path}${buildQuery(req.query)}`;
    const headers: Record<string, string> = {
      Authorization: authHeader(req.credentials),
      Accept: 'application/json',
    };
    const init: RequestInit = { method: req.method, headers };
    if (req.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = buildFormBody(req.form).toString();
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { _raw: text };
    }

    if (!res.ok) {
      const msg =
        (parsed?.message as string) ??
        (parsed?.detail as string) ??
        `Twilio ${res.status}`;
      throw new TwilioError(res.status, msg, parsed);
    }
    return parsed as T;
  }
}

/** Twilio numbers need E.164; we accept both "+5511…" and "5511…" input. */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}
