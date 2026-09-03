import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

export interface GoogleCalendarStatus {
  connected: boolean;
  email: string | null;
  enabled: boolean;
}

export interface CreateMeetEventInput {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
}

export interface CreateMeetEventResult {
  providerEventId: string;
  meetingUrl: string | null;
  htmlLink: string | null;
}

interface GoogleCalendarConfig {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email: string | null;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_EVENTS_URL =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');
const STATE_TTL_SECONDS = 600;
const STATE_KEY_PREFIX = 'google_calendar_oauth_state:';

/**
 * OAuth2 + Calendar API v3 via fetch puro (sem SDK `googleapis`), no mesmo
 * espírito de `integrations-status.service.ts` que já chama outros
 * provedores externos direto por fetch.
 *
 * `DataSource` direto em vez de `TenantTxHost`: o callback do OAuth
 * (`GET /google-calendar/callback`) é rota pública — o Google redireciona o
 * navegador pra cá sem que exista uma requisição autenticada com tenant
 * aberto — e `calendar_integrations` não tem FORCE ROW LEVEL SECURITY
 * (migration 20260420130000), então a conexão (dona da tabela) enxerga as
 * linhas normalmente sem precisar dos session vars que TenantTxHost seta.
 * Mesmo raciocínio documentado em `WebhookDispatchService`.
 */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private redis: Redis | null = null;

  constructor(private readonly dataSource: DataSource) {}

  private redisClient(): Redis {
    if (!this.redis) {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error('REDIS_URL não configurado');
      this.redis = new Redis(url);
    }
    return this.redis;
  }

  /** Segue o mesmo padrão de PUBLIC_API_URL usado por Twilio/Evolution/ElevenLabs para montar callback URLs — ver env.validation.ts. */
  private redirectUri(): string {
    if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
      return process.env.GOOGLE_OAUTH_REDIRECT_URI;
    }
    const base = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    return `${base}/google-calendar/callback`;
  }

  /** Exposta pro status endpoint — o admin precisa dessa URL exata pra cadastrar no Google Cloud Console ao trazer seu próprio client_id/secret. */
  getRedirectUri(): string {
    return this.redirectUri();
  }

  /**
   * Client ID/Secret podem vir por conta (colados em Integrações → vault,
   * mesmo mecanismo do Resend) ou, na ausência deles, das variáveis de
   * ambiente globais do servidor. Lê o vault direto via `DataSource`
   * (mesmo padrão de `EmailService.resolveApiKey`) em vez de injetar
   * `SecretsService` (REQUEST-scoped) — este service também é chamado fora
   * de uma requisição HTTP (ex.: fluxo do agente de voz).
   */
  private async resolveCredentials(
    accountId: string,
  ): Promise<{ clientId: string; clientSecret: string } | null> {
    const rows = await this.dataSource.query<
      { key_name: string; decrypted_secret: string }[]
    >(
      `SELECT s.key_name, vs.decrypted_secret
         FROM public.account_secrets s
         JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
        WHERE s.account_id = $1 AND s.provider = 'google_calendar'`,
      [accountId],
    );
    const stored = Object.fromEntries(rows.map((r) => [r.key_name, r.decrypted_secret]));
    const clientId = stored.client_id ?? process.env.GOOGLE_CLIENT_ID;
    const clientSecret = stored.client_secret ?? process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
  }

  private async assertConfigured(accountId: string): Promise<{
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }> {
    const creds = await this.resolveCredentials(accountId);
    if (!creds) {
      throw new Error(
        'Integração com Google não configurada — cole o Client ID/Secret em Configurações → Integrações ou defina GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no servidor.',
      );
    }
    return { ...creds, redirectUri: this.redirectUri() };
  }

  async isConfigured(accountId: string): Promise<boolean> {
    return (await this.resolveCredentials(accountId)) !== null;
  }

  async getAuthUrl(accountId: string, userId: string): Promise<string> {
    const { clientId, redirectUri } = await this.assertConfigured(accountId);
    const state = randomBytes(24).toString('hex');
    await this.redisClient().set(
      `${STATE_KEY_PREFIX}${state}`,
      JSON.stringify({ accountId, userId }),
      'EX',
      STATE_TTL_SECONDS,
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state: string,
  ): Promise<{ accountId: string }> {
    const key = `${STATE_KEY_PREFIX}${state}`;
    const raw = await this.redisClient().get(key);
    if (!raw) {
      throw new Error('Sessão de conexão expirada — inicie a conexão novamente.');
    }
    await this.redisClient().del(key);
    const { accountId, userId } = JSON.parse(raw) as {
      accountId: string;
      userId: string;
    };

    const { clientId, clientSecret, redirectUri } = await this.assertConfigured(accountId);
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Falha ao trocar código por token: HTTP ${tokenRes.status}`);
    }
    const token = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    let email: string | null = null;
    try {
      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (infoRes.ok) {
        const info = (await infoRes.json()) as { email?: string };
        email = info.email ?? null;
      }
    } catch {
      // não crítico — segue sem o e-mail de exibição.
    }

    const existing = await this.dataSource.query<
      { config: GoogleCalendarConfig }[]
    >(
      `SELECT config FROM public.calendar_integrations WHERE account_id = $1 AND provider = 'google_calendar'`,
      [accountId],
    );
    // Google só devolve refresh_token na primeira autorização (sem
    // `prompt=consent` forçado ele omite em reconexões) — preserva o antigo
    // se a resposta não trouxer um novo.
    const refreshToken = token.refresh_token ?? existing[0]?.config?.refresh_token;
    if (!refreshToken) {
      throw new Error(
        'Google não retornou refresh_token — revogue o acesso em myaccount.google.com/permissions e conecte novamente.',
      );
    }

    const config: GoogleCalendarConfig = {
      access_token: token.access_token,
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      email,
    };

    await this.dataSource.query(
      `INSERT INTO public.calendar_integrations
         (account_id, provider, config, enabled, last_synced_at, created_at, updated_at)
       VALUES ($1, 'google_calendar', $2::jsonb, true, now(), now(), now())
       ON CONFLICT (account_id, provider) DO UPDATE
         SET config = $2::jsonb, enabled = true, last_synced_at = now(), updated_at = now()`,
      [accountId, JSON.stringify(config)],
    );

    this.logger.log(`google_calendar conectado account=${accountId} por user=${userId}`);
    return { accountId };
  }

  async getStatus(accountId: string): Promise<GoogleCalendarStatus> {
    const rows = await this.dataSource.query<
      { config: GoogleCalendarConfig; enabled: boolean }[]
    >(
      `SELECT config, enabled FROM public.calendar_integrations WHERE account_id = $1 AND provider = 'google_calendar'`,
      [accountId],
    );
    const row = rows[0];
    if (!row) return { connected: false, email: null, enabled: false };
    return { connected: true, email: row.config?.email ?? null, enabled: row.enabled };
  }

  async disconnect(accountId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM public.calendar_integrations WHERE account_id = $1 AND provider = 'google_calendar'`,
      [accountId],
    );
  }

  private async getValidAccessToken(accountId: string): Promise<string> {
    const rows = await this.dataSource.query<
      { config: GoogleCalendarConfig }[]
    >(
      `SELECT config FROM public.calendar_integrations
        WHERE account_id = $1 AND provider = 'google_calendar' AND enabled = true`,
      [accountId],
    );
    const config = rows[0]?.config;
    if (!config) throw new Error('Google Calendar não conectado nesta conta.');

    if (new Date(config.expires_at).getTime() - Date.now() > 60_000) {
      return config.access_token;
    }

    const { clientId, clientSecret } = await this.assertConfigured(accountId);
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: config.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao renovar token do Google: HTTP ${res.status}`);
    }
    const token = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    const updated: GoogleCalendarConfig = {
      ...config,
      access_token: token.access_token,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    };
    await this.dataSource.query(
      `UPDATE public.calendar_integrations SET config = $2::jsonb, updated_at = now()
        WHERE account_id = $1 AND provider = 'google_calendar'`,
      [accountId, JSON.stringify(updated)],
    );
    return updated.access_token;
  }

  async createMeetEvent(
    accountId: string,
    input: CreateMeetEventInput,
  ): Promise<CreateMeetEventResult> {
    const accessToken = await this.getValidAccessToken(accountId);
    const res = await fetch(`${GOOGLE_EVENTS_URL}?conferenceDataVersion=1`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? undefined,
        start: { dateTime: input.startsAt.toISOString() },
        end: { dateTime: input.endsAt.toISOString() },
        attendees: input.attendeeEmails.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: randomBytes(12).toString('hex'),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Falha ao criar evento no Google Calendar: HTTP ${res.status} ${detail}`,
      );
    }
    const event = (await res.json()) as {
      id: string;
      hangoutLink?: string;
      htmlLink?: string;
    };
    return {
      providerEventId: event.id,
      meetingUrl: event.hangoutLink ?? null,
      htmlLink: event.htmlLink ?? null,
    };
  }

  async updateMeetEvent(
    accountId: string,
    providerEventId: string,
    patch: { startsAt?: Date; endsAt?: Date; title?: string },
  ): Promise<void> {
    const accessToken = await this.getValidAccessToken(accountId);
    const body: Record<string, unknown> = {};
    if (patch.title) body.summary = patch.title;
    if (patch.startsAt) body.start = { dateTime: patch.startsAt.toISOString() };
    if (patch.endsAt) body.end = { dateTime: patch.endsAt.toISOString() };
    const res = await fetch(`${GOOGLE_EVENTS_URL}/${providerEventId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Falha ao atualizar evento no Google Calendar: HTTP ${res.status} ${detail}`,
      );
    }
  }

  async cancelMeetEvent(accountId: string, providerEventId: string): Promise<void> {
    const accessToken = await this.getValidAccessToken(accountId);
    const res = await fetch(`${GOOGLE_EVENTS_URL}/${providerEventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Falha ao cancelar evento no Google Calendar: HTTP ${res.status} ${detail}`,
      );
    }
  }
}
