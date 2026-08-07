import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { SecretsService } from '../secrets/secrets.service';

/** Nó/workflow do n8n — só os campos que este cliente lê ou escreve. */
export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  webhookId?: string;
  parameters: Record<string, unknown>;
  disabled?: boolean;
  notes?: string;
  credentials?: Record<string, unknown>;
}

/** Um alvo de conexão: para onde uma saída aponta. */
export interface N8nConnectionEndpoint {
  node: string;
  type: string;
  index: number;
}

/**
 * Conexões do workflow, indexadas pelo nome do nó de ORIGEM. Cada tipo de
 * saída ("main" é a esmagadora maioria; nós de IA usam outras, ex.:
 * "ai_tool") mapeia para uma lista de "slots" (uma saída pode ter mais de uma
 * porta — um nó IF tem 2), e cada slot é a lista de conexões que saem dali.
 */
export type N8nConnections = Record<string, Record<string, N8nConnectionEndpoint[][]>>;

/**
 * `[key: string]: unknown` de propósito: a API do n8n devolve campos que este
 * cliente não conhece e nunca vai conhecer todos (a versão da instância do
 * cliente muda o que vem). Sem o índice, qualquer código que reconstruísse o
 * objeto campo a campo (em vez de clonar o que veio) apagaria silenciosamente
 * o que não está tipado aqui — exatamente o tipo de perda de dado que a
 * atualização incremental de workflow existe para evitar.
 */
export interface N8nWorkflow {
  id: string;
  name: string;
  active?: boolean;
  nodes: N8nNode[];
  connections: N8nConnections;
  settings?: Record<string, unknown>;
  staticData?: unknown;
  pinData?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  tags?: unknown[];
  versionId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 15_000;

/** Confere o mínimo para tratar uma resposta como workflow — pega "a API devolveu outra coisa" cedo. */
function looksLikeWorkflow(x: unknown): x is N8nWorkflow {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as { id?: unknown }).id === 'string' &&
    Array.isArray((x as { nodes?: unknown }).nodes) &&
    typeof (x as { connections?: unknown }).connections === 'object' &&
    (x as { connections?: unknown }).connections !== null
  );
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * true quando a instância do n8n vem fixada por variável de ambiente do
 * servidor (`N8N_URL` + `N8N_API_KEY`) — uma integração só, compartilhada por
 * todas as contas deste deploy, em vez de uma por conta no vault.
 *
 * Função solta (não método) de propósito: é a única fonte de verdade sobre
 * "está travado?", e tanto `N8nClientService.credentials` (decide de onde ler
 * a credencial) quanto `SecretsController` (decide se aceita escrita no
 * provider `n8n`) precisam da mesma resposta sem duplicar a checagem.
 */
export function n8nLockedByEnv(): boolean {
  return !!(process.env.N8N_URL?.trim() && process.env.N8N_API_KEY?.trim());
}

/**
 * Cliente HTTP fino para a API pública do n8n (`/api/v1/*`, autenticada por
 * `X-N8N-API-KEY`). Não conhece "workflow Utalks" nem "nó por agente" — isso
 * é responsabilidade do N8nIntegrationService; aqui é só o transporte.
 *
 * Credencial vem do vault (`account_secrets`, provider `n8n`): `api_url` +
 * `api_key`, mesmo padrão de dois campos que Twilio usa (account_sid +
 * auth_token) via `getInternalBulk`.
 */
@Injectable({ scope: Scope.REQUEST })
export class N8nClientService {
  private readonly logger = new Logger(N8nClientService.name);

  constructor(private readonly secrets: SecretsService) {}

  /**
   * `N8N_URL`/`N8N_API_KEY` no ambiente do servidor ganham de qualquer coisa
   * salva no vault da conta — é o que torna a integração "travada": mesmo que
   * uma conta tenha (ou tente salvar) credenciais próprias, elas nunca são
   * lidas enquanto o ambiente estiver configurado. `SecretsController` barra
   * a escrita pelo mesmo motivo, mas mesmo que algo escrevesse por fora dele
   * (migração, script), a leitura aqui ainda ignoraria.
   */
  async credentials(
    accountId: string,
  ): Promise<{ baseUrl: string; apiKey: string; source: 'env' | 'account' } | null> {
    if (n8nLockedByEnv()) {
      return {
        baseUrl: trimTrailingSlash(process.env.N8N_URL!),
        apiKey: process.env.N8N_API_KEY!.trim(),
        source: 'env',
      };
    }
    const bundle = await this.secrets.getInternalBulk(accountId, 'n8n');
    const baseUrl = trimTrailingSlash(bundle.api_url ?? '');
    const apiKey = (bundle.api_key ?? '').trim();
    if (!baseUrl || !apiKey) return null;
    return { baseUrl, apiKey, source: 'account' };
  }

  async isConfigured(accountId: string): Promise<boolean> {
    return (await this.credentials(accountId)) !== null;
  }

  /** Base pública da instância — usada para montar a URL final do webhook. */
  async requireBaseUrl(accountId: string): Promise<string> {
    const creds = await this.credentials(accountId);
    if (!creds) {
      throw new BadRequestException(
        'Integração n8n não configurada nesta conta. Salve a URL e a API key em Configurações > Integrações.',
      );
    }
    return creds.baseUrl;
  }

  private async request<T>(
    accountId: string,
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    const creds = await this.credentials(accountId);
    if (!creds) {
      throw new BadRequestException(
        'Integração n8n não configurada nesta conta. Salve a URL e a API key em Configurações > Integrações.',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${creds.baseUrl}/api/v1${path}`, {
        ...init,
        headers: {
          'X-N8N-API-KEY': creds.apiKey,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadRequestException(
        (err as Error).name === 'TimeoutError'
          ? `n8n não respondeu em ${REQUEST_TIMEOUT_MS / 1000}s.`
          : `Não foi possível chamar o n8n: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Nunca inclui a API key na mensagem — só status e corpo da resposta,
      // que são o que a instância do próprio cliente devolveu.
      if (res.status === 401 || res.status === 403) {
        throw new UnauthorizedException(
          'API key do n8n inválida, expirada ou sem permissão para esta operação.',
        );
      }
      if (res.status === 404) {
        throw new NotFoundException(`n8n: recurso não encontrado (${path}).`);
      }
      throw new BadRequestException(
        `n8n respondeu HTTP ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
      );
    }
    if (res.status === 204) return undefined as T;

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new BadRequestException('n8n devolveu uma resposta que não é JSON válido.');
    }
    return body as T;
  }

  /** Mesma leitura de `request()`, mas confere que a resposta parece mesmo um workflow. */
  private async requestWorkflow(
    accountId: string,
    path: string,
    init?: RequestInit,
  ): Promise<N8nWorkflow> {
    const body = await this.request<unknown>(accountId, path, init);
    if (!looksLikeWorkflow(body)) {
      throw new BadRequestException(
        `n8n devolveu uma resposta inesperada para ${path} (sem "id"/"nodes"/"connections" reconhecíveis).`,
      );
    }
    return body;
  }

  /**
   * Lista workflows, paginando até achar `limit` páginas — teto de segurança
   * (não de negócio): a API pública do n8n devolve cursor, não total, e uma
   * instância com milhares de workflows não deve travar esta chamada.
   */
  async listWorkflows(
    accountId: string,
    opts: { maxPages?: number } = {},
  ): Promise<N8nWorkflow[]> {
    const maxPages = opts.maxPages ?? 10;
    const all: N8nWorkflow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({ limit: '100' });
      if (cursor) qs.set('cursor', cursor);
      const body = await this.request<{
        data: N8nWorkflow[];
        nextCursor?: string | null;
      }>(accountId, `/workflows?${qs.toString()}`);
      all.push(...(body.data ?? []));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    return all;
  }

  async createWorkflow(
    accountId: string,
    input: {
      name: string;
      nodes: N8nNode[];
      connections: Record<string, unknown>;
      settings?: Record<string, unknown>;
    },
  ): Promise<N8nWorkflow> {
    return this.requestWorkflow(accountId, '/workflows', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getWorkflow(accountId: string, id: string): Promise<N8nWorkflow> {
    return this.requestWorkflow(accountId, `/workflows/${id}`);
  }

  /**
   * `nodes`/`connections` são substituição integral, não merge — é assim que
   * a API do n8n trata esses dois campos. Por isso quem chama sempre relê o
   * workflow inteiro antes, monta a lista completa (existentes + novo nó) e
   * manda de volta — nunca um nó isolado.
   *
   * PUT, não PATCH: a API pública do n8n (`/api/v1/workflows/{id}`) expõe
   * substituição integral via PUT. `payload` aceita qualquer formato de
   * objeto (não só o subconjunto estreito de antes) porque quem monta uma
   * atualização incremental precisa reenviar também campos que este cliente
   * não modela em detalhe (`staticData`, `pinData`, `meta`, `tags`…) — ver
   * `sanitizeWorkflowForUpdate` em n8n-workflow.util.ts.
   */
  async updateWorkflow(
    accountId: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<N8nWorkflow> {
    return this.requestWorkflow(accountId, `/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Melhor esforço: sem isso o path de produção (`/webhook/…`) não responde,
   * só o de teste (`/webhook-test/…`, que expira). Falha aqui não é fatal —
   * quem chama loga e segue, porque a instância pode exigir algo manual
   * (credencial de auth ainda não criada, por exemplo) que só o usuário
   * resolve no próprio n8n.
   */
  async activateWorkflow(accountId: string, id: string): Promise<void> {
    try {
      await this.request(accountId, `/workflows/${id}/activate`, {
        method: 'POST',
      });
    } catch (err) {
      this.logger.warn(
        `não foi possível ativar o workflow ${id}: ${(err as Error).message}`,
      );
    }
  }
}
