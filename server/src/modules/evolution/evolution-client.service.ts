import { Injectable } from '@nestjs/common';

// Ported from supabase/functions/_shared/evolution/index.ts — REST client
// for Evolution API (Baileys-based WhatsApp Web wrapper).

function toEvolutionNumber(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  return trimmed.replace(/[^\d]/g, '');
}

export type EvolutionConnectionState =
  'open' | 'connecting' | 'close' | 'qrReadSuccess' | 'qr' | 'loggedOut';

const DEFAULT_TIMEOUT_MS = 20_000;

export class EvolutionError extends Error {
  status: number;
  body: string;
  code?: string;
  constructor(message: string, status: number, body = '') {
    super(message);
    this.name = 'EvolutionError';
    this.status = status;
    this.body = body;
  }
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];

function webhookBody(webhookUrl: string, webhookSecret: string) {
  return {
    url: webhookUrl,
    byEvents: false,
    base64: true,
    headers: { 'x-nina-webhook-secret': webhookSecret },
    events: WEBHOOK_EVENTS,
  };
}

@Injectable()
export class EvolutionClientService {
  private async evo<T = Record<string, unknown>>(args: {
    url: string;
    apiKey: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<T> {
    const ctrl = new AbortController();
    const t = setTimeout(
      () => ctrl.abort(),
      args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      const res = await fetch(`${trimUrl(args.url)}${args.path}`, {
        method: args.method,
        headers: { apikey: args.apiKey, 'Content-Type': 'application/json' },
        body: args.body ? JSON.stringify(args.body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const bodyPreview = text.slice(0, 300).replace(/\s+/g, ' ').trim();
        throw new EvolutionError(
          `Evolution ${res.status} at ${args.path}${bodyPreview ? ` — ${bodyPreview}` : ''}`,
          res.status,
          text.slice(0, 500),
        );
      }
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(t);
    }
  }

  async ping(
    url: string,
    apiKey: string,
  ): Promise<{ ok: true; count: number }> {
    const list = await this.evo<unknown[]>({
      url,
      apiKey,
      method: 'GET',
      path: '/instance/fetchInstances',
    });
    return { ok: true, count: Array.isArray(list) ? list.length : 0 };
  }

  async setWebhook(args: {
    url: string;
    apiKey: string;
    instanceName: string;
    webhookUrl: string;
    webhookSecret: string;
  }): Promise<void> {
    try {
      await this.evo({
        url: args.url,
        apiKey: args.apiKey,
        method: 'POST',
        path: `/webhook/set/${encodeURIComponent(args.instanceName)}`,
        body: {
          webhook: webhookBody(args.webhookUrl, args.webhookSecret),
          enabled: true,
        },
      });
    } catch (err) {
      if (
        err instanceof EvolutionError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        await this.evo({
          url: args.url,
          apiKey: args.apiKey,
          method: 'POST',
          path: `/webhook/set/${encodeURIComponent(args.instanceName)}`,
          body: {
            ...webhookBody(args.webhookUrl, args.webhookSecret),
            enabled: true,
          },
        });
        return;
      }
      throw err;
    }
  }

  async createInstance(args: {
    url: string;
    apiKey: string;
    instanceName: string;
    webhookUrl: string;
    webhookSecret: string;
  }): Promise<{
    instanceName: string;
    token?: string;
    qrcode?: { base64?: string };
  }> {
    try {
      const res = await this.evo<{
        instance?: { instanceName?: string };
        hash?: { apikey?: string };
        qrcode?: { base64?: string };
      }>({
        url: args.url,
        apiKey: args.apiKey,
        method: 'POST',
        path: '/instance/create',
        body: {
          instanceName: args.instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          webhook: webhookBody(args.webhookUrl, args.webhookSecret),
        },
      });
      return {
        instanceName: res?.instance?.instanceName ?? args.instanceName,
        token: res?.hash?.apikey,
        qrcode: res?.qrcode,
      };
    } catch (err) {
      const isAlreadyExists =
        err instanceof EvolutionError &&
        (err.status === 409 ||
          (err.status === 403 && /already in use/i.test(err.body)));
      if (isAlreadyExists) {
        const e = new EvolutionError(
          `instance name already in use: ${args.instanceName}`,
          409,
          err instanceof EvolutionError ? err.body : '',
        );
        e.code = 'ALREADY_EXISTS';
        throw e;
      }
      throw err;
    }
  }

  async deleteInstance(args: {
    url: string;
    apiKey: string;
    instanceName: string;
  }): Promise<void> {
    try {
      await this.evo({
        url: args.url,
        apiKey: args.apiKey,
        method: 'DELETE',
        path: `/instance/delete/${encodeURIComponent(args.instanceName)}`,
      });
    } catch (err) {
      if (err instanceof EvolutionError && err.status === 404) return;
      throw err;
    }
  }

  async getQrCode(args: {
    url: string;
    apiKey: string;
    instanceName: string;
  }): Promise<{ base64?: string; pairingCode?: string; code?: string }> {
    return this.evo({
      url: args.url,
      apiKey: args.apiKey,
      method: 'GET',
      path: `/instance/connect/${encodeURIComponent(args.instanceName)}`,
    });
  }

  async getConnectionState(args: {
    url: string;
    apiKey: string;
    instanceName: string;
  }): Promise<{
    instance: { instanceName: string; state: EvolutionConnectionState };
  }> {
    return this.evo({
      url: args.url,
      apiKey: args.apiKey,
      method: 'GET',
      path: `/instance/connectionState/${encodeURIComponent(args.instanceName)}`,
    });
  }

  /** Send text. Accepts a phone-like string OR a full Baileys JID. */
  async sendText(args: {
    url: string;
    apiKey: string;
    instanceName: string;
    number: string;
    text: string;
  }): Promise<{ messageId?: string }> {
    const res = await this.evo<{
      key?: { id?: string };
      messageId?: string;
      id?: string;
    }>({
      url: args.url,
      apiKey: args.apiKey,
      method: 'POST',
      path: `/message/sendText/${encodeURIComponent(args.instanceName)}`,
      body: { number: toEvolutionNumber(args.number), text: args.text },
    });
    return { messageId: res?.key?.id ?? res?.messageId ?? res?.id };
  }
}

export function normalizeStatus(
  state: string | undefined,
): 'connected' | 'qr_ready' | 'connecting' | 'disconnected' {
  switch (state) {
    case 'open':
      return 'connected';
    case 'qr':
    case 'qrReadSuccess':
      return 'qr_ready';
    case 'connecting':
      return 'connecting';
    default:
      return 'disconnected';
  }
}

export function instanceNameFor(accountId: string, suffix?: string): string {
  const short = accountId.replace(/-/g, '').slice(0, 12);
  if (!suffix) return `nina_${short}`;
  const normalized = suffix.replace(/-/g, '').slice(0, 8).toLowerCase();
  return `nina_${short}_${normalized}`;
}
