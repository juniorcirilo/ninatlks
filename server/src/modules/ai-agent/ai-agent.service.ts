import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import {
  AI_AGENT_SECRET_PROVIDER,
  GLOBAL_SKILL,
  LEGACY_SECRET_PROVIDERS,
} from '../../common/llm/ai-agent-runtime';
import { SecretsService } from '../secrets/secrets.service';
import {
  OpencodeBridgeService,
  listOpenAiModels,
  type BridgeEventSink,
} from './opencode-bridge.service';
import { ExternalDbService } from './external-db.service';
import { UsageLogService } from './usage-log.service';
import { brand } from './brand';
import { SQL_DIALECTS, type SqlDialect } from './tool-sql';
import { buildSkillAuthorPrompt, parseGeneratedSkill } from './skill-author';

interface SettingsRow {
  enabled: boolean;
  system_prompt: string;
  temperature: string;
  effort: string;
  reply_length: string;
  reply_language: string;
  history_turns: number;
  fallback_models: string[];
}

export interface SkillRow {
  persona_id?: string | null;
  persona_name?: string | null;
  /** 'generated' = criada pelo botão "Gerar com IA Agent" (uma por agente) */
  origin?: 'manual' | 'generated';
  id: string;
  slug: string;
  name: string;
  description: string;
  body: string;
  enabled: boolean;
}

export interface SettingsPatch {
  enabled?: boolean;
  systemPrompt?: string;
  temperature?: number;
  effort?: string;
  replyLength?: string;
  replyLanguage?: string;
  historyTurns?: number;
  fallbackModels?: string[];
}

export interface ToolRow {
  id: string;
  slug: string;
  name: string;
  kind: string;
  connection: SqlDialect;
  description: string;
  max_rows: number;
  enabled: boolean;
  persona_id: string | null;
  persona_name?: string | null;
}

/** Nome técnico de ferramenta: minúsculas, números e _ (até 24). */
export function toolSlug(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 24)
    .replace(/_+$/g, '');
  return s || 'banco';
}

export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return s || 'skill';
}

@Injectable({ scope: Scope.REQUEST })
export class AiAgentService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly secrets: SecretsService,
    private readonly bridge: OpencodeBridgeService,
    private readonly db: ExternalDbService,
    private readonly usage: UsageLogService,
  ) {}

  /**
   * Query com SAVEPOINT: no PostgreSQL um erro aborta a transação inteira, e
   * vários pontos aqui tratam o erro (migration pendente, slug duplicado) e
   * seguem com outra query na mesma transação.
   */
  private async q<T = unknown>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T> {
    const sp = `sp_${randomBytes(4).toString('hex')}`;
    const m = this.tx.manager;
    await m.query(`SAVEPOINT ${sp}`);
    try {
      const r = await m.query<T>(sql, params);
      await m.query(`RELEASE SAVEPOINT ${sp}`);
      return r;
    } catch (err) {
      await m.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw err;
    }
  }

  /**
   * Lê a conexão salva; se a chave atual estiver vazia, procura nos nomes
   * antigos (ver LEGACY_SECRET_PROVIDERS) e, achando algo, já regrava sob o
   * nome atual — a partir daí os nomes antigos não são mais consultados.
   */
  private async loadConnection(
    accountId: string,
  ): Promise<Record<string, string>> {
    let own = await this.secrets.getInternalBulk(
      accountId,
      AI_AGENT_SECRET_PROVIDER,
    );
    if (own.base_url && own.model_id) return own;
    for (const legacy of LEGACY_SECRET_PROVIDERS) {
      const old = await this.secrets.getInternalBulk(accountId, legacy);
      if (!old.base_url && !old.model_id && !old.api_key) continue;
      const merged = { ...old, ...own };
      for (const [k, v] of Object.entries(merged)) {
        if (v)
          await this.secrets.set(accountId, AI_AGENT_SECRET_PROVIDER, k, v);
      }
      own = merged;
      if (own.base_url && own.model_id) break;
    }
    return own;
  }

  async overview(accountId: string) {
    // Se a migration AiAgentBehavior ainda não rodou (colunas novas ausentes),
    // abre a página com padrões e avisa, em vez de falhar com erro 500.
    let s: SettingsRow | undefined;
    let migrationPending = false;
    try {
      [s] = await this.q<SettingsRow[]>(
        `SELECT enabled, system_prompt, temperature, effort, reply_length,
                reply_language, history_turns, fallback_models
           FROM ai_agent_settings WHERE account_id = $1`,
        [accountId],
      );
    } catch (err) {
      if ((err as { code?: string }).code !== '42703') throw err;
      migrationPending = true;
      [s] = await this.q<SettingsRow[]>(
        `SELECT enabled, system_prompt, temperature
           FROM ai_agent_settings WHERE account_id = $1`,
        [accountId],
      );
    }
    const own = await this.loadConnection(accountId);
    return {
      migration_pending: migrationPending,
      settings: {
        enabled: s?.enabled ?? true,
        system_prompt: s?.system_prompt ?? '',
        temperature: s ? Number(s.temperature) : 0.5,
        effort: s?.effort ?? '',
        reply_length: s?.reply_length ?? 'curta',
        reply_language: s?.reply_language ?? '',
        history_turns: s?.history_turns ?? 8,
        fallback_models: s?.fallback_models ?? [],
      },
      connection: {
        base_url: own.base_url ?? '',
        has_key: !!own.api_key,
        model_id: own.model_id ?? '',
        connected: !!own.base_url && !!own.model_id,
      },
      /** skill do sistema: sempre ativa e somente leitura */
      global_skill: {
        slug: GLOBAL_SKILL.slug,
        name: GLOBAL_SKILL.name,
        description: GLOBAL_SKILL.description,
        body: GLOBAL_SKILL.body,
      },
      skills: await this.listSkills(accountId),
      tools: await this.listTools(accountId),
      connections: {
        postgresql: !!(await this.db.config(accountId, 'postgresql')),
        mssql: !!(await this.db.config(accountId, 'mssql')),
      },
      // Client ID (tenant) configurado? Sem ele as consultas ficam bloqueadas.
      tenants: {
        postgresql: !!(await this.db.config(accountId, 'postgresql'))?.clientId,
        mssql: !!(await this.db.config(accountId, 'mssql'))?.clientId,
      },
    };
  }

  async saveConnection(
    accountId: string,
    body: { baseUrl?: string; apiKey?: string; modelId?: string },
  ) {
    if (body.baseUrl !== undefined) {
      if (body.baseUrl.trim())
        await this.secrets.set(
          accountId,
          AI_AGENT_SECRET_PROVIDER,
          'base_url',
          body.baseUrl.trim(),
        );
      else
        await this.secrets.delete(
          accountId,
          AI_AGENT_SECRET_PROVIDER,
          'base_url',
        );
    }
    if (body.apiKey?.trim())
      await this.secrets.set(
        accountId,
        AI_AGENT_SECRET_PROVIDER,
        'api_key',
        body.apiKey.trim(),
      );
    if (body.modelId !== undefined) {
      if (body.modelId.trim())
        await this.secrets.set(
          accountId,
          AI_AGENT_SECRET_PROVIDER,
          'model_id',
          body.modelId.trim(),
        );
      else
        await this.secrets.delete(
          accountId,
          AI_AGENT_SECRET_PROVIDER,
          'model_id',
        );
    }
    return { ok: true };
  }

  async removeConnection(accountId: string) {
    for (const k of ['base_url', 'api_key', 'model_id'])
      await this.secrets.delete(accountId, AI_AGENT_SECRET_PROVIDER, k);
    return { ok: true };
  }

  /** Campos digitados ou, se vazios, os já salvos (a chave nunca volta ao navegador). */
  private async creds(
    accountId: string,
    body: { baseUrl?: string; apiKey?: string; modelId?: string },
  ) {
    const own = await this.loadConnection(accountId);
    return {
      baseUrl: body.baseUrl?.trim() || own.base_url || '',
      apiKey: body.apiKey?.trim() || own.api_key || '',
      modelId: body.modelId?.trim() || own.model_id || '',
    };
  }

  /** Modelos do endpoint configurado (GET /models). */
  async models(accountId: string, body: { baseUrl?: string; apiKey?: string }) {
    const { baseUrl, apiKey } = await this.creds(accountId, body);
    if (!baseUrl)
      throw new BadRequestException('Informe a Base URL do endpoint.');
    try {
      return {
        models: await listOpenAiModels(baseUrl, apiKey || undefined),
      };
    } catch (err) {
      throw new BadRequestException(
        brand(`Falha ao listar modelos: ${(err as Error).message}`),
      );
    }
  }

  /** Testa de verdade: chama o endpoint (com a skill global) numa pergunta curta. */
  async test(
    accountId: string,
    body: { baseUrl?: string; apiKey?: string; modelId?: string },
  ) {
    const { baseUrl, apiKey, modelId } = await this.creds(accountId, body);
    if (!baseUrl || !modelId)
      throw new BadRequestException(
        'Informe a Base URL e o modelo para testar.',
      );
    try {
      const r = await this.bridge.reply({
        accountId,
        baseUrl,
        apiKey,
        models: [modelId],
        skills: [],
        systemPrompt: 'Você é um teste de conexão. Responda apenas: OK',
        history: [{ role: 'user', content: 'ping' }],
      });
      void this.usage.success({ accountId, kind: 'test' }, r);
      return {
        ok: true as const,
        message: `IA Agent respondeu (${r.model}): ${r.text.slice(0, 80)}`,
      };
    } catch (err) {
      void this.usage.failure({ accountId, kind: 'test' }, err, [modelId]);
      throw new BadRequestException(brand((err as Error).message));
    }
  }

  async updateSettings(accountId: string, p: SettingsPatch) {
    try {
      await this.writeSettings(accountId, p);
    } catch (err) {
      if ((err as { code?: string }).code === '42703')
        throw new ConflictException(
          'Há migrations pendentes no banco. Rode `npm run migration` e tente de novo.',
        );
      throw err;
    }
    return { ok: true };
  }

  private async writeSettings(accountId: string, p: SettingsPatch) {
    await this.q(
      `INSERT INTO ai_agent_settings
         (account_id, enabled, system_prompt, temperature, effort, reply_length,
          reply_language, history_turns, fallback_models)
       VALUES ($1, COALESCE($2, true), COALESCE($3, ''), COALESCE($4, 0.5),
               COALESCE($5, ''), COALESCE($6, 'curta'), COALESCE($7, ''),
               COALESCE($8, 8), COALESCE($9::text[], '{}'))
       ON CONFLICT (account_id) DO UPDATE SET
         enabled = COALESCE($2, ai_agent_settings.enabled),
         system_prompt = COALESCE($3, ai_agent_settings.system_prompt),
         temperature = COALESCE($4, ai_agent_settings.temperature),
         effort = COALESCE($5, ai_agent_settings.effort),
         reply_length = COALESCE($6, ai_agent_settings.reply_length),
         reply_language = COALESCE($7, ai_agent_settings.reply_language),
         history_turns = COALESCE($8, ai_agent_settings.history_turns),
         fallback_models = COALESCE($9::text[], ai_agent_settings.fallback_models)`,
      [
        accountId,
        p.enabled ?? null,
        p.systemPrompt ?? null,
        p.temperature ?? null,
        p.effort ?? null,
        p.replyLength ?? null,
        p.replyLanguage ?? null,
        p.historyTurns ?? null,
        p.fallbackModels
          ? [...new Set(p.fallbackModels.map((m) => m.trim()).filter(Boolean))]
          : null,
      ],
    );
    return { ok: true };
  }

  // ─── uso e consumo (dashboard) ──────────────────────────────────────────

  async usageSummary(accountId: string, daysIn?: number) {
    const days = Math.min(90, Math.max(1, Math.floor(daysIn ?? 30)));
    const period = `${days} days`;
    try {
      const [totals] = await this.q<Record<string, string | null>[]>(
        `SELECT count(*) AS calls,
                count(*) FILTER (WHERE ok) AS ok_calls,
                count(*) FILTER (WHERE kind = 'reply') AS replies,
                count(*) FILTER (WHERE fallback_count > 0) AS with_fallback,
                count(*) FILTER (WHERE provider = 'legacy') AS legacy_calls,
                COALESCE(sum(tokens_in), 0) AS tokens_in,
                COALESCE(sum(tokens_out), 0) AS tokens_out,
                COALESCE(sum(tokens_reasoning), 0) AS tokens_reasoning,
                COALESCE(sum(tokens_cache), 0) AS tokens_cache,
                COALESCE(sum(cost), 0) AS cost,
                COALESCE(round(avg(duration_ms) FILTER (WHERE ok)), 0) AS avg_ms
           FROM ai_agent_usage
          WHERE account_id = $1 AND created_at >= now() - $2::interval`,
        [accountId, period],
      );
      const byDay = await this.q<Record<string, string>[]>(
        `SELECT to_char((created_at AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS day,
                count(*) AS calls,
                count(*) FILTER (WHERE ok) AS ok_calls,
                COALESCE(sum(tokens_in + tokens_out + tokens_reasoning), 0) AS tokens,
                COALESCE(sum(cost), 0) AS cost
           FROM ai_agent_usage
          WHERE account_id = $1 AND created_at >= now() - $2::interval
          GROUP BY 1 ORDER BY 1`,
        [accountId, period],
      );
      const byModel = await this.q<Record<string, string>[]>(
        `SELECT COALESCE(model, '(provedor padrão)') AS model, provider,
                count(*) AS calls,
                count(*) FILTER (WHERE ok) AS ok_calls,
                COALESCE(sum(tokens_in + tokens_out + tokens_reasoning), 0) AS tokens,
                COALESCE(sum(cost), 0) AS cost,
                COALESCE(round(avg(duration_ms) FILTER (WHERE ok)), 0) AS avg_ms
           FROM ai_agent_usage
          WHERE account_id = $1 AND created_at >= now() - $2::interval
          GROUP BY 1, 2 ORDER BY calls DESC LIMIT 20`,
        [accountId, period],
      );
      const byAgent = await this.q<Record<string, string | null>[]>(
        `SELECT u.persona_id, COALESCE(p.name, 'Sem agente') AS name,
                count(*) AS calls,
                COALESCE(sum(u.tokens_in + u.tokens_out + u.tokens_reasoning), 0) AS tokens,
                COALESCE(sum(u.cost), 0) AS cost
           FROM ai_agent_usage u
           LEFT JOIN agent_personas p ON p.id = u.persona_id
          WHERE u.account_id = $1 AND u.created_at >= now() - $2::interval
          GROUP BY 1, 2 ORDER BY calls DESC LIMIT 20`,
        [accountId, period],
      );
      const errors = await this.q<Record<string, string | null>[]>(
        `SELECT created_at, kind, model, provider, error
           FROM ai_agent_usage
          WHERE account_id = $1 AND NOT ok AND created_at >= now() - $2::interval
          ORDER BY created_at DESC LIMIT 10`,
        [accountId, period],
      );
      let db = { queries: '0', failed: '0' } as Record<string, string>;
      try {
        const [d] = await this.q<Record<string, string>[]>(
          `SELECT count(*) FILTER (WHERE action = 'query') AS queries,
                  count(*) FILTER (WHERE error IS NOT NULL) AS failed
             FROM ai_agent_query_log
            WHERE account_id = $1 AND created_at >= now() - $2::interval`,
          [accountId, period],
        );
        db = d ?? db;
      } catch (err) {
        if ((err as { code?: string }).code !== '42P01') throw err;
      }
      return {
        migration_pending: false,
        days,
        totals,
        by_day: byDay,
        by_model: byModel,
        by_agent: byAgent,
        errors: errors.map((e) => ({ ...e, error: brand(e.error) })),
        db,
      };
    } catch (err) {
      // 42P01 = migration AiAgentUsage pendente
      if ((err as { code?: string }).code !== '42P01') throw err;
      return { migration_pending: true, days };
    }
  }

  // ─── ferramentas (acesso somente leitura a bancos externos) ─────────────

  async listTools(accountId: string): Promise<ToolRow[]> {
    try {
      return await this.q<ToolRow[]>(
        `SELECT t.id, t.slug, t.name, t.kind, t.connection, t.description,
                t.max_rows, t.enabled, t.persona_id, p.name AS persona_name
           FROM ai_agent_tools t
           LEFT JOIN agent_personas p ON p.id = t.persona_id
          WHERE t.account_id = $1 ORDER BY t.name`,
        [accountId],
      );
    } catch (err) {
      // 42P01 = migration AiAgentTools pendente
      if ((err as { code?: string }).code !== '42P01') throw err;
      return [];
    }
  }

  async createTool(
    accountId: string,
    t: {
      name: string;
      slug?: string;
      connection: SqlDialect;
      description?: string;
      maxRows?: number;
      personaId?: string;
    },
  ) {
    if (!SQL_DIALECTS.includes(t.connection))
      throw new BadRequestException('Conexão inválida.');
    const base = t.slug ?? toolSlug(t.name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base.slice(0, 21)}_${i + 1}`;
      try {
        const [row] = await this.q<ToolRow[]>(
          `INSERT INTO ai_agent_tools (account_id, persona_id, slug, name, connection, description, max_rows)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,50))
           RETURNING id, slug, name, kind, connection, description, max_rows, enabled, persona_id`,
          [
            accountId,
            t.personaId ?? null,
            slug,
            t.name.trim(),
            t.connection,
            (t.description ?? '').trim(),
            t.maxRows ?? null,
          ],
        );
        return row;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === '23505') continue;
        if (code === '42P01')
          throw new ConflictException(
            'Há migrations pendentes no banco. Rode `npm run migration` e tente de novo.',
          );
        throw err;
      }
    }
    throw new ConflictException(
      'Não foi possível escolher um nome técnico único.',
    );
  }

  async updateTool(
    accountId: string,
    id: string,
    t: {
      name?: string;
      description?: string;
      maxRows?: number;
      enabled?: boolean;
    },
  ) {
    const [row] = await this.q<ToolRow[]>(
      `UPDATE ai_agent_tools SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         max_rows = COALESCE($5, max_rows), enabled = COALESCE($6, enabled)
       WHERE id = $1 AND account_id = $2
       RETURNING id, slug, name, kind, connection, description, max_rows, enabled, persona_id`,
      [
        id,
        accountId,
        t.name?.trim() ?? null,
        t.description?.trim() ?? null,
        t.maxRows ?? null,
        t.enabled ?? null,
      ],
    );
    if (!row) throw new NotFoundException('tool not found');
    return row;
  }

  async deleteTool(accountId: string, id: string) {
    const rows = await this.q<{ id: string }[]>(
      `DELETE FROM ai_agent_tools WHERE id = $1 AND account_id = $2 RETURNING id`,
      [id, accountId],
    );
    if (!rows[0]) throw new NotFoundException('tool not found');
    return { ok: true };
  }

  /** Testa as credenciais salvas em Integrações (PostgreSQL / SQL Server). */
  async testDbConnection(accountId: string, type: string) {
    if (!SQL_DIALECTS.includes(type as SqlDialect))
      throw new BadRequestException('Conexão inválida.');
    try {
      const version = await this.db.test(accountId, type as SqlDialect);
      return { ok: true as const, message: `Conectado: ${version}` };
    } catch (err) {
      throw new BadRequestException(
        `Falha na conexão: ${(err as Error).message}`.slice(0, 300),
      );
    }
  }

  // ─── skills ─────────────────────────────────────────────────────────────

  async listSkills(accountId: string): Promise<SkillRow[]> {
    try {
      return await this.q<SkillRow[]>(
        `SELECT k.id, k.slug, k.name, k.description, k.body, k.enabled,
                k.persona_id, k.origin, p.name AS persona_name
           FROM ai_agent_skills k
           LEFT JOIN agent_personas p ON p.id = k.persona_id
          WHERE k.account_id = $1 ORDER BY k.name`,
        [accountId],
      );
    } catch (err) {
      // 42703 = coluna ainda não existe (migrations anteriores pendentes).
      if ((err as { code?: string }).code !== '42703') throw err;
    }
    try {
      return await this.q<SkillRow[]>(
        `SELECT k.id, k.slug, k.name, k.description, k.body, k.enabled,
                k.persona_id, p.name AS persona_name
           FROM ai_agent_skills k
           LEFT JOIN agent_personas p ON p.id = k.persona_id
          WHERE k.account_id = $1 ORDER BY k.name`,
        [accountId],
      );
    } catch (err) {
      // Migration AiAgentPersonaSkills pendente: lista sem o vínculo com agente.
      if ((err as { code?: string }).code !== '42703') throw err;
      return this.q<SkillRow[]>(
        `SELECT id, slug, name, description, body, enabled
           FROM ai_agent_skills WHERE account_id = $1 ORDER BY name`,
        [accountId],
      );
    }
  }

  /**
   * Pede ao IA Agent que ANALISE a descrição do agente e crie uma skill;
   * salva (ligada ao agente, se `personaId`) e devolve a skill. Usa o modelo
   * principal e os fallbacks da página Agente de IA.
   */
  async generateSkill(
    accountId: string,
    input: { name: string; description: string; personaId?: string },
    onEvent?: BridgeEventSink,
    signal?: AbortSignal,
  ) {
    const own = await this.loadConnection(accountId);
    if (!own.base_url || !own.model_id)
      throw new BadRequestException(
        'Configure a Base URL e o modelo em Configurações → Agente de IA → Modelos antes de gerar uma skill.',
      );
    let fallbacks: string[] = [];
    let replyLength = 'curta';
    try {
      const [row] = await this.q<
        { fallback_models: string[]; reply_length: string }[]
      >(
        `SELECT fallback_models, reply_length FROM ai_agent_settings WHERE account_id = $1`,
        [accountId],
      );
      fallbacks = row?.fallback_models ?? [];
      replyLength = row?.reply_length ?? 'curta';
    } catch {
      /* migration pendente: sem fallbacks/tamanho configurado */
    }
    // A skill gerada deve combinar com o que o agente realmente pode fazer:
    // se ele tem ferramentas de banco, a skill pode orientar a usá-las.
    let hasDbTools = false;
    try {
      const [row] = await this.q<{ t: unknown[] }[]>(
        `SELECT public.ai_agent_tools_list($1, $2) AS t`,
        [accountId, input.personaId ?? null],
      );
      hasDbTools = (row?.t?.length ?? 0) > 0;
    } catch {
      /* migration pendente: sem ferramentas */
    }

    let generated;
    try {
      const r = await this.bridge.reply({
        accountId,
        baseUrl: own.base_url,
        apiKey: own.api_key ?? '',
        models: [own.model_id, ...fallbacks],
        skills: [],
        systemPrompt: '',
        history: [],
        temperature: 0.4,
        rawPrompt: buildSkillAuthorPrompt(input.name, input.description, {
          hasDbTools,
          replyLength,
        }),
        onEvent,
        signal,
        // Geração de skill é interativa (a pessoa está esperando na tela):
        // falha rápido em vez de somar o timeout dos 3 modelos de fallback.
        overallTimeoutMs: 75_000,
      });
      void this.usage.success(
        { accountId, personaId: input.personaId, kind: 'skill_gen' },
        r,
      );
      generated = parseGeneratedSkill(r.text);
    } catch (err) {
      void this.usage.failure(
        { accountId, personaId: input.personaId, kind: 'skill_gen' },
        err,
        [own.model_id],
      );
      throw new BadRequestException(
        brand(`Não foi possível gerar a skill: ${(err as Error).message}`),
      );
    }

    // Regenerar (personaId): atualiza a skill já gerada deste agente, se
    // houver, em vez de criar uma duplicata a cada clique em "Gerar/Regenerar".
    if (input.personaId) {
      try {
        const [row] = await this.q<SkillRow[]>(
          `UPDATE ai_agent_skills SET name = $3, description = $4, body = $5, enabled = true
             WHERE account_id = $1 AND persona_id = $2 AND origin = 'generated'
             RETURNING id, slug, name, description, body, enabled, persona_id`,
          [
            accountId,
            input.personaId,
            generated.name,
            generated.description,
            generated.body,
          ],
        );
        if (row) return row;
      } catch (err) {
        // 42703 = migration AiAgentSkillOrigin pendente: segue para criar nova.
        if ((err as { code?: string }).code !== '42703') throw err;
      }
    }

    // slug único (a skill global é reservada; colisões ganham sufixo)
    const base = slugify(generated.name);
    for (let i = 0; i < 20; i++) {
      const slug = i === 0 ? base : `${base.slice(0, 60)}-${i + 1}`;
      if (slug === GLOBAL_SKILL.slug) continue;
      try {
        const [row] = await this.q<SkillRow[]>(
          `INSERT INTO ai_agent_skills (account_id, slug, name, description, body, enabled, persona_id, origin)
           VALUES ($1,$2,$3,$4,$5,true,$6,'generated')
           RETURNING id, slug, name, description, body, enabled, persona_id`,
          [
            accountId,
            slug,
            generated.name,
            generated.description,
            generated.body,
            input.personaId ?? null,
          ],
        );
        return row;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') continue;
        if ((err as { code?: string }).code === '42703')
          throw new ConflictException(
            'Há migrations pendentes no banco. Rode `npm run migration` e tente de novo.',
          );
        throw err;
      }
    }
    throw new ConflictException(
      'Não foi possível escolher um nome único para a skill.',
    );
  }

  async createSkill(
    accountId: string,
    s: {
      name: string;
      description: string;
      body: string;
      enabled?: boolean;
      slug?: string;
      personaId?: string;
    },
  ) {
    const slug = s.slug ?? slugify(s.name);
    if (slug === GLOBAL_SKILL.slug)
      throw new ConflictException(`"${slug}" é reservado para a skill global.`);
    try {
      const [row] = await this.q<SkillRow[]>(
        `INSERT INTO ai_agent_skills (account_id, slug, name, description, body, enabled, persona_id)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7)
         RETURNING id, slug, name, description, body, enabled, persona_id`,
        [
          accountId,
          slug,
          s.name.trim(),
          s.description.trim(),
          s.body,
          s.enabled ?? null,
          s.personaId ?? null,
        ],
      );
      return row;
    } catch (err) {
      if ((err as { code?: string }).code === '23505')
        throw new ConflictException(`Já existe uma skill "${slug}".`);
      throw err;
    }
  }

  async updateSkill(
    accountId: string,
    id: string,
    s: {
      name?: string;
      description?: string;
      body?: string;
      enabled?: boolean;
    },
  ) {
    const [row] = await this.q<SkillRow[]>(
      `UPDATE ai_agent_skills SET
         name = COALESCE($3, name), description = COALESCE($4, description),
         body = COALESCE($5, body), enabled = COALESCE($6, enabled)
       WHERE id = $1 AND account_id = $2
       RETURNING id, slug, name, description, body, enabled`,
      [
        id,
        accountId,
        s.name?.trim() ?? null,
        s.description?.trim() ?? null,
        s.body ?? null,
        s.enabled ?? null,
      ],
    );
    if (!row) throw new NotFoundException('skill not found');
    return row;
  }

  async deleteSkill(accountId: string, id: string) {
    const rows = await this.q<{ id: string }[]>(
      `DELETE FROM ai_agent_skills WHERE id = $1 AND account_id = $2 RETURNING id`,
      [id, accountId],
    );
    if (!rows[0]) throw new NotFoundException('skill not found');
    return { ok: true };
  }
}
