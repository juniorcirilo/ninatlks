import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { TenantTxHost } from '../../common/tenant-tx.host';

/**
 * Catálogo de eventos que um destino pode assinar. Lista fechada de propósito:
 * evento digitado à mão nunca dispararia, e o cliente só descobriria isso
 * esperando um webhook que não chega.
 */
export const WEBHOOK_EVENTS = [
  'call.finished',
  'call.transferred',
  'meeting.scheduled',
  'meeting.rescheduled',
  'campaign.finished',
  'contact.disposition_changed',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_METHODS = ['POST', 'GET'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** Quantos destinos uma conta pode manter. Teto de sanidade, não de plano. */
const MAX_ENDPOINTS_PER_ACCOUNT = 20;

export interface WebhookEndpointRow {
  id: string;
  name: string;
  url: string;
  method: WebhookMethod;
  events: string[];
  secret: string;
  active: boolean;
  agent_id: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable({ scope: Scope.REQUEST })
export class WebhookEndpointsService {
  constructor(private readonly tx: TenantTxHost) {}

  /** `agentId` filtra para "destinos deste agente + destinos globais" — é o que a aba do agente mostra. */
  async list(accountId: string, agentId?: string): Promise<WebhookEndpointRow[]> {
    if (agentId) {
      return this.tx.manager.query<WebhookEndpointRow[]>(
        `SELECT id, name, url, method, events, secret, active, agent_id, created_at, updated_at
           FROM public.account_webhook_endpoints
          WHERE account_id = $1 AND (agent_id = $2 OR agent_id IS NULL)
          ORDER BY created_at ASC`,
        [accountId, agentId],
      );
    }
    return this.tx.manager.query<WebhookEndpointRow[]>(
      `SELECT id, name, url, method, events, secret, active, agent_id, created_at, updated_at
         FROM public.account_webhook_endpoints
        WHERE account_id = $1
        ORDER BY created_at ASC`,
      [accountId],
    );
  }

  async create(
    accountId: string,
    userId: string,
    input: {
      name: string;
      url: string;
      method?: string;
      events?: string[];
      active?: boolean;
      agent_id?: string | null;
    },
  ): Promise<WebhookEndpointRow> {
    const count = await this.tx.manager.query<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM public.account_webhook_endpoints WHERE account_id = $1`,
      [accountId],
    );
    if (Number(count[0]?.n ?? 0) >= MAX_ENDPOINTS_PER_ACCOUNT) {
      throw new BadRequestException(
        `Limite de ${MAX_ENDPOINTS_PER_ACCOUNT} destinos por conta atingido. Remova um destino antes de cadastrar outro.`,
      );
    }

    const url = normalizeUrl(input.url);
    const method = normalizeMethod(input.method);
    const events = normalizeEvents(input.events);
    const agentId = await this.normalizeAgentId(accountId, input.agent_id);
    const secret = randomBytes(32).toString('hex');

    try {
      const rows = await this.tx.manager.query<WebhookEndpointRow[]>(
        `INSERT INTO public.account_webhook_endpoints
           (account_id, name, url, method, events, secret, active, created_by_id, agent_id)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9)
         RETURNING id, name, url, method, events, secret, active, agent_id, created_at, updated_at`,
        [
          accountId,
          input.name.trim(),
          url,
          method,
          events,
          secret,
          input.active ?? true,
          userId,
          agentId,
        ],
      );
      return rows[0];
    } catch (e) {
      throw translateUniqueViolation(e);
    }
  }

  /** Confere que o agente é da própria conta antes de amarrar — devolve null intacto (destino global). */
  private async normalizeAgentId(
    accountId: string,
    agentId: string | null | undefined,
  ): Promise<string | null> {
    if (!agentId) return null;
    const found = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM public.agent_personas WHERE id = $1 AND account_id = $2`,
      [agentId, accountId],
    );
    if (!found.length) {
      throw new BadRequestException('Agente não encontrado nesta conta.');
    }
    return agentId;
  }

  async update(
    accountId: string,
    id: string,
    patch: {
      name?: string;
      url?: string;
      method?: string;
      events?: string[];
      active?: boolean;
      agent_id?: string | null;
    },
  ): Promise<WebhookEndpointRow> {
    await this.requireEndpoint(accountId, id);

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (fragment: string, value: unknown) => {
      params.push(value);
      sets.push(`${fragment} = $${params.length}`);
    };

    if (patch.name !== undefined) push('name', patch.name.trim());
    if (patch.url !== undefined) push('url', normalizeUrl(patch.url));
    if (patch.method !== undefined) push('method', normalizeMethod(patch.method));
    if (patch.events !== undefined) {
      params.push(normalizeEvents(patch.events));
      sets.push(`events = $${params.length}::text[]`);
    }
    if (patch.active !== undefined) push('active', patch.active);
    // `null` explícito é "virar destino global" — distinto de "não veio no corpo".
    if (patch.agent_id !== undefined) {
      push('agent_id', await this.normalizeAgentId(accountId, patch.agent_id));
    }

    if (sets.length > 0) {
      params.push(id);
      try {
        // UPDATE sem RETURNING e SELECT depois: o retorno de query() para
        // UPDATE ... RETURNING é `[linhas, afetadas]`, não a lista de linhas —
        // mesmo tropeço já documentado no revoke de chave de API.
        await this.tx.manager.query(
          `UPDATE public.account_webhook_endpoints
              SET ${sets.join(', ')}
            WHERE id = $${params.length}`,
          params,
        );
      } catch (e) {
        throw translateUniqueViolation(e);
      }
    }

    const [row] = await this.tx.manager.query<WebhookEndpointRow[]>(
      `SELECT id, name, url, method, events, secret, active, agent_id, created_at, updated_at
         FROM public.account_webhook_endpoints WHERE id = $1`,
      [id],
    );
    return row;
  }

  /**
   * Apaga de verdade, ao contrário da chave de API: não há rastro de uso nesta
   * linha que valha guardar, e destino inativo já é o jeito de "desligar sem
   * perder a configuração".
   */
  async remove(accountId: string, id: string): Promise<{ ok: true }> {
    await this.requireEndpoint(accountId, id);
    await this.tx.manager.query(
      `DELETE FROM public.account_webhook_endpoints WHERE id = $1`,
      [id],
    );
    return { ok: true };
  }

  /** Novo segredo para o destino — usado quando o antigo vaza. */
  async rotateSecret(
    accountId: string,
    id: string,
  ): Promise<WebhookEndpointRow> {
    await this.requireEndpoint(accountId, id);
    const secret = randomBytes(32).toString('hex');
    await this.tx.manager.query(
      `UPDATE public.account_webhook_endpoints SET secret = $1 WHERE id = $2`,
      [secret, id],
    );
    const [row] = await this.tx.manager.query<WebhookEndpointRow[]>(
      `SELECT id, name, url, method, events, secret, active, agent_id, created_at, updated_at
         FROM public.account_webhook_endpoints WHERE id = $1`,
      [id],
    );
    return row;
  }

  private async requireEndpoint(accountId: string, id: string): Promise<void> {
    const found = await this.tx.manager.query<{ id: string }[]>(
      `SELECT id FROM public.account_webhook_endpoints
        WHERE id = $1 AND account_id = $2`,
      [id, accountId],
    );
    if (!found.length) {
      throw new NotFoundException('Destino de webhook não encontrado');
    }
  }
}

/**
 * Normaliza a URL antes de gravar para o índice único valer algo: sem isso
 * `https://x.com/hook` e `https://x.com/hook/` passam como destinos distintos
 * e o cliente recebe cada evento duas vezes.
 */
function normalizeUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new BadRequestException('URL inválida');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('A URL precisa começar com http:// ou https://');
  }
  parsed.hash = '';
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}

function normalizeMethod(method?: string): WebhookMethod {
  if (!method) return 'POST';
  const upper = method.trim().toUpperCase();
  if (!WEBHOOK_METHODS.includes(upper as WebhookMethod)) {
    throw new BadRequestException(`Método inválido: ${method}. Use GET ou POST.`);
  }
  return upper as WebhookMethod;
}

function normalizeEvents(events?: string[]): string[] {
  if (!events?.length) return [];
  const unknown = events.filter(
    (e) => !WEBHOOK_EVENTS.includes(e as WebhookEvent),
  );
  if (unknown.length) {
    throw new BadRequestException(
      `Evento desconhecido: ${unknown.join(', ')}`,
    );
  }
  return [...new Set(events)];
}

/**
 * Colisão no índice `(account_id, url)` chega como 23505 e viraria 500. Vira
 * 409 com o motivo, porque é erro do operador e tem correção óbvia.
 */
function translateUniqueViolation(e: unknown): unknown {
  if ((e as { code?: string })?.code === '23505') {
    return new ConflictException('Já existe um destino com essa URL.');
  }
  return e;
}
