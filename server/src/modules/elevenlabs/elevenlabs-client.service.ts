import { Injectable } from '@nestjs/common';

// Ported from supabase/functions/_shared/elevenlabs/client.ts.

const BASE = 'https://api.elevenlabs.io';

export interface ElevenLabsCredentials {
  apiKey: string;
}

export class ElevenLabsError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ElevenLabsError';
    this.status = status;
    this.details = details;
  }
}

export interface ElevenRequest {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  path: string;
  credentials: ElevenLabsCredentials;
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  form?: FormData;
  raw?: boolean;
}

function buildQuery(q: ElevenRequest['query']): string {
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
export class ElevenLabsClientService {
  async request<T = unknown>(req: ElevenRequest): Promise<T> {
    const url = `${BASE}${req.path}${buildQuery(req.query)}`;
    const headers: Record<string, string> = {
      'xi-api-key': req.credentials.apiKey,
      Accept: 'application/json',
    };
    const init: RequestInit = { method: req.method, headers };
    if (req.json) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.json);
    } else if (req.form) {
      init.body = req.form;
    }

    const res = await fetch(url, init);
    if (req.raw) return res as unknown as T;

    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { _raw: text };
    }
    if (!res.ok) {
      const detail = parsed?.detail as
        { message?: string } | string | undefined;
      const msg =
        (typeof detail === 'object' ? detail?.message : detail) ??
        (parsed?.message as string) ??
        `ElevenLabs ${res.status}`;
      throw new ElevenLabsError(
        res.status,
        typeof msg === 'string' ? msg : JSON.stringify(msg),
        parsed,
      );
    }
    return parsed as T;
  }
}
