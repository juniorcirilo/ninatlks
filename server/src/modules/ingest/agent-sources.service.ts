import { assertSafeOutboundUrl } from '../../common/outbound-url.util';
import { evalSafeExpression } from '../../common/safe-expr.util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IngestService, IngestBatchResult } from './ingest.service';
import { ResolveSyncFailureDto } from './dto/resolve-sync-failure.dto';

/** Fonte lenta não pode segurar o job: corta em 20s. */
const FETCH_TIMEOUT_MS = 20_000;

/** Teto por busca, alinhado ao lote do recebimento por push. */
const MAX_ROWS = 500;

export interface AgentSourceRow {
  id: string;
  account_id: string;
  agent_id: string;
  name: string;
  url: string;
  method: string;
  token_header: string;
  token_prefix: string;
  body_template: Record<string, unknown> | null;
  root_path: string | null;
  field_map: Record<string, string>;
  variables_map: Record<string, string>;
  list_key: string | null;
  campaign_kind: string | null;
  schedule_minutes: number | null;
  active: boolean;
  last_run_at: Date | null;
  last_status: string | null;
  last_error: string | null;
  last_count: number | null;
}

export interface RunResult {
  ok: boolean;
  /** Persona (uuid) da fonte — usado pela tela pra resolver manualmente uma
   * falha de "empresa não identificada" sem o operador precisar informar. */
  agentId?: string;
  fetched: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  error?: string;
  /** Primeiras linhas já traduzidas — é o que deixa o operador conferir o mapeamento. */
  sample: Record<string, unknown>[];
  /**
   * Variáveis mapeadas que não vieram preenchidas em nenhuma linha. Não é erro
   * — variável da fala é opcional —, mas é o sintoma de chave com nome
   * diferente na origem, que de outro modo só apareceria quando a agente
   * ligasse sem o dado.
   */
  emptyVariables: string[];
  /**
   * Linhas que não chegaram a virar contato nem título/orçamento no banco,
   * com o motivo. Não inclui o skip "contato já existe" — esse ainda grava o
   * título/orçamento (ver contactId em IngestRowResult), só não atualiza nome/telefone
   * do contato.
   */
  failures: {
    label: string;
    externalId?: string;
    vendedor?: string;
    reason: string;
    /** Tudo que se sabe da linha — o que veio da fonte (variables) mais os
     * campos de contato — pra tela abrir "ver tudo" sem ter que adivinhar. */
    details: Record<string, unknown>;
  }[];
  /**
   * Empresas dos clientes desta corrida — agrupado por empresa, pra aba
   * "Empresas" do preview de sincronização mostrar de cara a quais grupos os
   * clientes recém-sincronizados pertencem (ou "sem empresa", pra quem
   * ficou sem `empresa_id`).
   */
  companies: {
    companyId: string | null;
    companyName: string;
    externalId: string | null;
    contacts: { name: string | null; phone: string }[];
  }[];
  /**
   * Lista operacional criada nesta corrida com os títulos/orçamentos NOVOS
   * (ver `sync_operational_list` na migration OperationalListSyncRun) — só
   * para fontes de agente com `document_kind` (cobrança/orçamento). `null`
   * quando a fonte não é desse tipo, ou quando não achou item novo (tudo já
   * estava numa lista operacional em aberto de corrida anterior).
   */
  operationalList: { id: string; name: string; itemCount: number } | null;
}

/**
 * Busca ativa (pull) da fonte de dados de um agente.
 *
 * Reusa `IngestService.ingestAgentContacts`, o mesmo caminho do recebimento
 * por push: telefone como chave, insert-only (contato existente é ignorado),
 * lista operacional do agente, variáveis em `ingest_variables`. O que este
 * serviço faz de diferente é só chegar até os dados e traduzi-los — quem
 * grava é o caminho já testado.
 *
 * DataSource direto porque o poller roda em job de fila, sem sessão.
 */
@Injectable()
export class AgentSourcesService {
  private readonly logger = new Logger(AgentSourcesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ingest: IngestService,
  ) {}

  async getRow(sourceId: string): Promise<AgentSourceRow> {
    const rows = await this.dataSource.query<AgentSourceRow[]>(
      `SELECT * FROM public.agent_inbound_sources WHERE id = $1`,
      [sourceId],
    );
    if (!rows.length) throw new NotFoundException('Fonte não encontrada');
    return rows[0];
  }

  /**
   * Fontes da conta para a tela. Nunca devolve o token — ele mora no vault, e o
   * que a tela precisa saber é só se existe (`has_token`), para diferenciar
   * "sem token" de "token guardado" no formulário.
   *
   * `effective_list_key` é o que liga a fonte à lista operacional: sem
   * `list_key` explícito, o destino é a lista do próprio agente.
   */
  async list(accountId: string) {
    return this.dataSource.query(
      `SELECT s.id, s.agent_id, s.name, s.url, s.method, s.token_header,
              s.token_prefix, s.body_template, s.root_path, s.field_map,
              s.variables_map, s.list_key, s.campaign_kind, s.schedule_minutes,
              s.active, s.last_run_at, s.last_status, s.last_error, s.last_count,
              (s.running_since IS NOT NULL) AS running,
              coalesce(s.list_key, 'agent:' || s.agent_id::text) AS effective_list_key,
              p.name AS agent_name, p.document_kind,
              exists (
                SELECT 1 FROM public.account_secrets sec
                 WHERE sec.account_id = s.account_id
                   AND sec.provider = 'agent-source'
                   AND sec.key_name = s.id::text
              ) AS has_token
         FROM public.agent_inbound_sources s
         LEFT JOIN public.agent_personas p ON p.id = s.agent_id
        WHERE s.account_id = $1
        ORDER BY s.created_at ASC`,
      [accountId],
    );
  }

  /**
   * Toda persona da conta, com um flag dizendo se ela já tem fonte de dados
   * configurada — usado pela sincronização com o n8n para decidir, por
   * agente, entre duas ações: quem já tem fonte só ganha o nó garantido no
   * workflow (protetor, não mexe na fonte); quem não tem ganha fonte nova.
   *
   * `EXISTS` em vez de `DISTINCT ON` em `agent_inbound_sources`: precisa dos
   * agentes SEM fonte também, não só de quem já tem uma.
   */
  async listAgentsForN8nSync(
    accountId: string,
  ): Promise<Array<{ agentId: string; agentName: string; hasSource: boolean }>> {
    const rows = await this.dataSource.query<
      { agent_id: string; agent_name: string; has_source: boolean }[]
    >(
      `SELECT p.id AS agent_id, p.name AS agent_name,
              EXISTS (
                SELECT 1 FROM public.agent_inbound_sources s
                 WHERE s.account_id = p.account_id AND s.agent_id = p.id
              ) AS has_source
         FROM public.agent_personas p
        WHERE p.account_id = $1
        ORDER BY p.name ASC`,
      [accountId],
    );
    return rows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.agent_name,
      hasSource: r.has_source,
    }));
  }

  async create(
    accountId: string,
    userId: string,
    dto: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `INSERT INTO public.agent_inbound_sources
         (account_id, agent_id, name, url, method, token_header, token_prefix,
          body_template, root_path, field_map, variables_map, list_key,
          campaign_kind, schedule_minutes, active, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        accountId,
        dto.agentId,
        dto.name,
        dto.url,
        dto.method ?? 'GET',
        dto.tokenHeader ?? 'Authorization',
        dto.tokenPrefix ?? 'Bearer ',
        dto.bodyTemplate ? JSON.stringify(dto.bodyTemplate) : null,
        dto.rootPath ?? null,
        JSON.stringify(dto.fieldMap ?? {}),
        JSON.stringify(dto.variablesMap ?? {}),
        dto.listKey ?? null,
        dto.campaignKind ?? null,
        dto.scheduleMinutes ?? null,
        dto.active ?? true,
        userId,
      ],
    );
    return { id: rows[0].id };
  }

  async update(
    accountId: string,
    sourceId: string,
    dto: Record<string, unknown>,
  ): Promise<{ ok: true }> {
    await this.requireSource(accountId, sourceId);

    const columns: Record<string, string> = {
      agentId: 'agent_id',
      name: 'name',
      url: 'url',
      method: 'method',
      tokenHeader: 'token_header',
      tokenPrefix: 'token_prefix',
      rootPath: 'root_path',
      listKey: 'list_key',
      campaignKind: 'campaign_kind',
      scheduleMinutes: 'schedule_minutes',
      active: 'active',
    };
    const jsonColumns: Record<string, string> = {
      bodyTemplate: 'body_template',
      fieldMap: 'field_map',
      variablesMap: 'variables_map',
    };

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [key, column] of Object.entries(columns)) {
      if (dto[key] === undefined) continue;
      params.push(dto[key]);
      sets.push(`${column} = $${params.length}`);
    }
    for (const [key, column] of Object.entries(jsonColumns)) {
      if (dto[key] === undefined) continue;
      params.push(JSON.stringify(dto[key]));
      sets.push(`${column} = $${params.length}::jsonb`);
    }

    if (sets.length > 0) {
      params.push(sourceId);
      await this.dataSource.query(
        `UPDATE public.agent_inbound_sources SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
    }
    return { ok: true };
  }

  async remove(accountId: string, sourceId: string): Promise<{ ok: true }> {
    await this.requireSource(accountId, sourceId);
    await this.dataSource.query(
      `DELETE FROM public.agent_inbound_sources WHERE id = $1`,
      [sourceId],
    );
    return { ok: true };
  }

  async requireSource(accountId: string, sourceId: string): Promise<void> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM public.agent_inbound_sources WHERE id = $1 AND account_id = $2`,
      [sourceId, accountId],
    );
    if (!rows.length) throw new NotFoundException('Fonte não encontrada');
  }

  /**
   * Busca, traduz e grava. Nunca lança por erro da fonte: o resultado (inclusive
   * a falha) é gravado na própria linha, que é o que a tela mostra como "última
   * execução" — erro de integração é informação operacional, não exceção.
   *
   * Uma execução por vez, por fonte: o botão Sincronizar, o duplo clique nele e
   * o poller disputam a mesma linha, e duas buscas simultâneas dobrariam o
   * trabalho e criariam dois lotes de aprovação na campanha.
   */
  async run(sourceId: string): Promise<RunResult> {
    const source = await this.getRow(sourceId);
    if (!(await this.acquireLock(sourceId))) {
      throw new ConflictException(
        'Esta fonte já está sincronizando agora. Espere terminar.',
      );
    }
    try {
      return await this.runLocked(source);
    } finally {
      await this.dataSource.query(
        `UPDATE public.agent_inbound_sources SET running_since = NULL WHERE id = $1`,
        [sourceId],
      );
    }
  }

  /**
   * Trava expira em 15 minutos: processo morto no meio da busca não pode deixar
   * a fonte travada para sempre — o timeout do fetch é 20s, então 15 minutos só
   * é atingido por queda mesmo.
   */
  private async acquireLock(sourceId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `UPDATE public.agent_inbound_sources
          SET running_since = now()
        WHERE id = $1
          AND (running_since IS NULL OR running_since < now() - interval '15 minutes')
        RETURNING id`,
      [sourceId],
    );
    // UPDATE ... RETURNING via query() devolve [linhas, afetadas]; o primeiro
    // elemento é a lista, e é o tamanho dela que diz se a trava foi obtida.
    const returned = (Array.isArray(rows[0]) ? rows[0] : rows) as unknown[];
    return returned.length > 0;
  }

  private async runLocked(source: AgentSourceRow): Promise<RunResult> {
    const sourceId = source.id;
    const token = await this.readToken(source.account_id, source.id);
    // Antes de tocar na fonte — é o corte que `sync_operational_list` usa
    // pra saber quais títulos/orçamentos esta corrida específica tocou
    // (`updated_at >= runStartedAt`).
    const runStartedAt = new Date();

    let result: RunResult;
    try {
      const payload = await this.fetchSource(source, token);
      const rows = this.extractRows(payload, source.root_path);
      const mapped = rows.slice(0, MAX_ROWS).map((r) => this.mapRow(source, r));

      // Fontes de relacionamento (cobrança, por exemplo) trazem N linhas para o
      // mesmo telefone — uma por título/parcela em aberto do cliente. Antes
      // isso exigia um dedupe aqui (`ingest_agent_contact` só gravava um
      // blob por contato, então múltiplas linhas do mesmo telefone se
      // pisavam — confirmado em produção: cliente com 46 títulos em aberto
      // ficava só com o menos urgente). Com `cobranca_titulos`/
      // `orcamentos_erp` chaveadas por (contact_id, numero_titulo/
      // numero_orcamento), cada linha vira sua própria upsert — não precisa
      // mais reduzir pra uma por telefone antes de ingerir.
      const usable = mapped.filter((m) => m.phone);
      if (usable.length === 0) {
        throw new BadRequestException(
          rows.length === 0
            ? 'A resposta não trouxe nenhuma linha. Confira a URL e o caminho da lista (root_path).'
            : `Nenhuma das ${rows.length} linha(s) trouxe telefone. Confira o mapeamento do campo phone — chaves disponíveis na primeira linha: ${Object.keys(rows[0] ?? {}).slice(0, 12).join(', ')}`,
        );
      }

      // Vendedor não é um campo de primeira classe do mapRow (só phone/name/
      // email/externalId são) — vem solto dentro de `variables`, sob uma das
      // duas chaves que as fontes já usam (ver legacyVendedorNome em
      // cobranca-data.server.ts/quotes-data.server.ts). Precisa ser
      // extraído aqui e mandado como `vendedorNome` de primeira classe para
      // o ingest gravar em `companies.vendedor_id`/`vendedor_nome_erp` — se
      // ficar só em `variables`, o payload da função `ingest_agent_contact`
      // nunca tem a chave `vendedorNome` e o vendedor não aparece em
      // Cobranças/Orçamentos.
      const vendedorDe = (variables: Record<string, unknown>): string | undefined => {
        const v = variables['vendedor_nome'] ?? variables['vendedor_responsavel'];
        return typeof v === 'string' ? v : undefined;
      };

      const ingested: IngestBatchResult = await this.ingest.ingestAgentContacts(
        source.account_id,
        usable.map((m) => ({
          agent: source.agent_id,
          phone: m.phone!,
          name: m.name,
          email: m.email,
          externalId: m.externalId,
          empresaId: m.empresaId,
          empresaNome: m.empresaNome,
          vendedorNome: vendedorDe(m.variables),
          variables: m.variables,
          campaignKind: source.campaign_kind ?? undefined,
          listKey: source.list_key ?? undefined,
        })),
      );

      const preenchidas = new Set<string>();
      for (const m of mapped) {
        for (const key of Object.keys(m.variables)) preenchidas.add(key);
      }
      // Por telefone: é a chave que sobrevive até o resultado de
      // ingestAgentContacts (a linha mapeada em si não viaja até lá) — guarda
      // a linha mapeada inteira pra poder montar o "ver tudo" da falha.
      const mappedByPhone = new Map<string, (typeof mapped)[number]>();
      for (const m of mapped) {
        if (m.phone) mappedByPhone.set(m.phone, m);
      }

      // Linhas sem telefone algum não chegam a ser mandadas pro ingest — sem
      // isso, elas simplesmente somem da contagem sem nenhum rastro de qual
      // cliente ficou de fora e por quê.
      const semTelefone = mapped
        .filter((m) => !m.phone)
        .map((m) => ({
          label: m.name || m.externalId || '(sem telefone e sem nome)',
          externalId: m.externalId,
          vendedor: vendedorDe(m.variables),
          reason: 'Sem telefone válido na resposta da fonte',
          details: {
            nome: m.name ?? null,
            telefone: m.phone ?? null,
            email: m.email ?? null,
            codigoCliente: m.externalId ?? null,
            ...m.variables,
          },
        }));
      const naoGravadas = ingested.results
        // contactId presente = a linha teve efeito no banco (título/orçamento
        // gravado mesmo quando o contato em si não foi atualizado). Comparar
        // pelo texto do motivo (BENIGN_SKIP_REASON) é frágil: um conflito de
        // concorrência (ON CONFLICT DO NOTHING na inserção do contato) retorna
        // o MESMO texto sem nunca ter chegado a gravar título/orçamento — só
        // contactId distingue os dois casos (ver doc de IngestRowResult).
        .filter((r) => r.skipped && !r.contactId)
        .map((r) => {
          const m = mappedByPhone.get(r.phone);
          return {
            label: r.name || r.phone || '(sem identificação)',
            externalId: m?.externalId,
            vendedor: m ? vendedorDe(m.variables) : undefined,
            reason: r.reason ?? 'motivo desconhecido',
            details: {
              nome: r.name ?? m?.name ?? null,
              telefone: r.phone ?? null,
              email: m?.email ?? null,
              codigoCliente: m?.externalId ?? null,
              motivo: r.reason ?? 'motivo desconhecido',
              ...(m?.variables ?? {}),
            },
          };
        });

      const operationalList = await this.syncOperationalList(source, runStartedAt);
      if (rows.length > 0) await this.pruneStaleDocuments(source, runStartedAt);

      result = {
        ok: true,
        agentId: source.agent_id,
        fetched: rows.length,
        processed: ingested.processed,
        created: ingested.created,
        updated: ingested.updated,
        skipped: ingested.skipped + (mapped.length - usable.length),
        // Mescla `variables` (aninhado no mapRow) junto com os campos
        // principais — sem isso a aba "Dados" do preview mostrava uma
        // coluna "variables" com "[object Object]" em vez das variáveis
        // de verdade lado a lado com nome/telefone/etc.
        sample: mapped.slice(0, 3).map((m) => ({
          nome: m.name ?? null,
          telefone: m.phone ?? null,
          email: m.email ?? null,
          codigoCliente: m.externalId ?? null,
          empresaId: m.empresaId ?? null,
          empresaNome: m.empresaNome ?? null,
          ...m.variables,
        })),
        emptyVariables: Object.keys(source.variables_map ?? {}).filter(
          (v) => !preenchidas.has(v),
        ),
        failures: [...semTelefone, ...naoGravadas],
        companies: await this.companiesFor(
          source.account_id,
          usable.map((m) => m.phone!).filter(Boolean),
        ),
        operationalList,
      };
    } catch (err) {
      result = {
        ok: false,
        fetched: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        error: (err as Error).message,
        sample: [],
        emptyVariables: [],
        failures: [],
        companies: [],
        operationalList: null,
      };
    }

    await this.dataSource.query(
      `UPDATE public.agent_inbound_sources
          SET last_run_at = now(), last_status = $2, last_error = $3, last_count = $4
        WHERE id = $1`,
      [
        sourceId,
        result.ok ? 'ok' : 'erro',
        result.error ?? null,
        result.processed,
      ],
    );

    // Só a última corrida importa pra investigar "por que X não virou
    // contato" — substitui em vez de acumular pra não confundir com falha já
    // resolvida numa corrida anterior. `result.ok === false` (fonte não
    // respondeu/JSON inválido) não tem falha por linha pra gravar aqui — o
    // erro geral já fica em `last_error`.
    if (result.ok) {
      await this.persistFailures(source.account_id, sourceId, result.failures);
    }

    this.logger.log(
      `fonte=${source.name} agente=${source.agent_id} buscados=${result.fetched} gravados=${result.processed} erro=${result.error ?? '—'}`,
    );
    return result;
  }

  private async persistFailures(
    accountId: string,
    sourceId: string,
    failures: RunResult['failures'],
  ): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM public.agent_source_sync_failures WHERE source_id = $1`,
      [sourceId],
    );
    if (failures.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    failures.forEach((f, i) => {
      const base = i * 7;
      values.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb)`,
      );
      params.push(accountId, sourceId, f.label, f.externalId ?? null, f.vendedor ?? null, f.reason, JSON.stringify(f.details));
    });
    await this.dataSource.query(
      `INSERT INTO public.agent_source_sync_failures
         (account_id, source_id, label, external_id, vendedor, reason, details)
       VALUES ${values.join(', ')}`,
      params,
    );
  }

  /** Falhas da última corrida desta fonte — sobrevive ao fechamento do modal
   * de sincronização, pra dar pra investigar depois "por que X não virou
   * contato" sem precisar sincronizar de novo. */
  async listFailures(
    accountId: string,
    sourceId: string,
  ): Promise<RunResult['failures']> {
    const rows = await this.dataSource.query<
      { label: string; external_id: string | null; vendedor: string | null; reason: string; details: Record<string, unknown> }[]
    >(
      `SELECT label, external_id, vendedor, reason, details
         FROM public.agent_source_sync_failures
        WHERE account_id = $1 AND source_id = $2
        ORDER BY created_at ASC`,
      [accountId, sourceId],
    );
    return rows.map((r) => ({
      label: r.label,
      externalId: r.external_id ?? undefined,
      vendedor: r.vendedor ?? undefined,
      reason: r.reason,
      details: r.details,
    }));
  }

  /**
   * Agrupa os títulos/orçamentos NOVOS desta corrida (que não estão em
   * nenhuma lista operacional em aberto) numa lista nova — só para agentes
   * de cobrança/orçamento (`agent_personas.document_kind`); sem isso, no-op.
   * `sync_operational_list` (migration OperationalListSyncRun) decide o que
   * é "novo" e faz a gravação inteira numa transação só.
   */
  /**
   * A fonte é a verdade: título/orçamento que a API não devolveu nesta corrida
   * (pago, baixado, cancelado) sai do app. O upsert do ingest só insere/atualiza
   * (`updated_at = now()`), então o que ficou com `updated_at` anterior ao início
   * da corrida não veio na resposta. Só roda com resposta não vazia, pra uma
   * falha da API devolvendo `[]` não apagar tudo.
   */
  private async pruneStaleDocuments(
    source: AgentSourceRow,
    runStartedAt: Date,
  ): Promise<void> {
    const table = await this.dataSource.query<{ document_kind: string | null }[]>(
      `SELECT document_kind FROM public.agent_personas WHERE id = $1 AND account_id = $2`,
      [source.agent_id, source.account_id],
    );
    const kind = table[0]?.document_kind;
    const name =
      kind === 'cobranca' ? 'cobranca_titulos' : kind === 'orcamento' ? 'orcamentos_erp' : null;
    if (!name) return;
    const removed: unknown[] = await this.dataSource.query(
      `DELETE FROM public.${name}
        WHERE account_id = $1 AND persona_id = $2 AND updated_at < $3
        RETURNING id`,
      [source.account_id, source.agent_id, runStartedAt],
    );
    if (removed.length > 0) {
      this.logger.log(`fonte=${source.name} removidos-obsoletos=${removed.length} (${name})`);
    }
  }

  private async syncOperationalList(
    source: AgentSourceRow,
    runStartedAt: Date,
  ): Promise<RunResult['operationalList']> {
    const personaRows = await this.dataSource.query<
      { document_kind: string | null }[]
    >(
      `SELECT document_kind FROM public.agent_personas WHERE id = $1 AND account_id = $2`,
      [source.agent_id, source.account_id],
    );
    const documentKind = personaRows[0]?.document_kind ?? null;
    if (documentKind !== 'cobranca' && documentKind !== 'orcamento') return null;

    const rows = await this.dataSource.query<
      { sync_operational_list: { created: boolean; listId?: string; listName?: string; itemCount: number } }[]
    >(
      `SELECT public.sync_operational_list($1, $2, $3, $4) AS sync_operational_list`,
      [source.account_id, source.agent_id, documentKind, runStartedAt],
    );
    const r = rows[0]?.sync_operational_list;
    if (!r?.created || !r.listId || !r.listName) return null;
    return { id: r.listId, name: r.listName, itemCount: r.itemCount };
  }

  /**
   * Reconciliação manual de uma linha de sync bloqueada por "empresa não
   * identificada" (ver IngestRequireCompanyForDocuments20260908050000) — a
   * tela de Cobranças/Orçamentos manda de volta os dados da falha (telefone/
   * nome/email/variables, tirados do `details` que a corrida anterior já
   * devolveu) mais a empresa que o operador escolheu ou acabou de criar.
   */
  async resolveSyncFailure(
    accountId: string,
    dto: ResolveSyncFailureDto,
  ): Promise<{ ok: boolean; skipped: boolean; reason?: string }> {
    const ingested: IngestBatchResult = await this.ingest.ingestAgentContacts(
      accountId,
      [
        {
          agent: dto.agent,
          phone: dto.phone,
          name: dto.name,
          email: dto.email,
          variables: dto.variables ?? {},
          companyId: dto.companyId,
        },
      ],
    );
    const row = ingested.results[0];
    // insertAgentContact captura a exceção do banco por linha (não deixa uma
    // linha ruim derrubar o lote) e devolve como skipped+reason em vez de
    // lançar — "companyId não pertence a esta conta" (raise dentro de
    // ingest_agent_contact) chega aqui assim, não como exception.
    if (row?.reason?.includes('companyId não pertence a esta conta')) {
      throw new BadRequestException('Empresa selecionada não pertence a esta conta.');
    }
    return { ok: true, skipped: row?.skipped ?? false, reason: row?.reason };
  }

  /** Empresas dos clientes recém-processados, agrupadas — aba "Empresas" do
   * preview de sincronização. */
  private async companiesFor(
    accountId: string,
    phones: string[],
  ): Promise<RunResult['companies']> {
    if (phones.length === 0) return [];
    const rows = await this.dataSource.query<
      {
        phone: string;
        contact_name: string | null;
        company_id: string | null;
        company_name: string | null;
        external_id: string | null;
      }[]
    >(
      `SELECT c.phone_number AS phone, c.name AS contact_name,
              co.id AS company_id, co.name AS company_name, co.external_id
         FROM public.contacts c
         LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE c.account_id = $1 AND c.phone_number = ANY($2)`,
      [accountId, phones],
    );

    const groups = new Map<
      string,
      { companyId: string | null; companyName: string; externalId: string | null; contacts: { name: string | null; phone: string }[] }
    >();
    for (const r of rows) {
      const key = r.company_id ?? '__none';
      if (!groups.has(key)) {
        groups.set(key, {
          companyId: r.company_id,
          companyName: r.company_name ?? 'Sem empresa vinculada',
          externalId: r.external_id,
          contacts: [],
        });
      }
      groups.get(key)!.contacts.push({ name: r.contact_name, phone: r.phone });
    }
    return Array.from(groups.values());
  }

  /** Fontes ativas com agendamento vencido e que não estejam já rodando. */
  async listDue(): Promise<AgentSourceRow[]> {
    return this.dataSource.query<AgentSourceRow[]>(
      `SELECT * FROM public.agent_inbound_sources
        WHERE active
          AND schedule_minutes IS NOT NULL
          AND running_since IS NULL
          AND (last_run_at IS NULL
               OR last_run_at < now() - make_interval(mins => schedule_minutes))
        ORDER BY last_run_at NULLS FIRST
        LIMIT 50`,
    );
  }

  private async readToken(
    accountId: string,
    sourceId: string,
  ): Promise<string | null> {
    const rows = await this.dataSource.query<{ decrypted_secret: string }[]>(
      `SELECT vs.decrypted_secret
         FROM public.account_secrets s
         JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
        WHERE s.account_id = $1 AND s.provider = 'agent-source' AND s.key_name = $2`,
      [accountId, sourceId],
    );
    return rows[0]?.decrypted_secret ?? null;
  }

  private async fetchSource(
    source: AgentSourceRow,
    token: string | null,
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers[source.token_header] = `${source.token_prefix ?? ''}${token}`;
    }
    const init: RequestInit = {
      method: source.method,
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    };
    if (source.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(source.body_template ?? {});
    }

    let res: Response;
    try {
      await assertSafeOutboundUrl(source.url);
      // Redirect manual: um 30x não pode levar a um destino interno.
      init.redirect = 'error';
      res = await fetch(source.url, init);
    } catch (err) {
      throw new BadRequestException(
        (err as Error).name === 'TimeoutError'
          ? `A fonte não respondeu em ${FETCH_TIMEOUT_MS / 1000}s.`
          : `Não foi possível chamar a fonte: ${(err as Error).message}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadRequestException(
        `A fonte respondeu HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new BadRequestException('A resposta da fonte não é JSON válido.');
    }
  }

  /**
   * Acha a lista de linhas na resposta. Sem `root_path`, aceita tanto um array
   * na raiz quanto o embrulho de uma chave só (`{"clientes":[…]}`), que é o
   * formato de metade das APIs e não vale obrigar a configurar.
   */
  private extractRows(
    payload: unknown,
    rootPath: string | null,
  ): Record<string, unknown>[] {
    const target = rootPath ? readPath(payload, rootPath) : payload;
    if (Array.isArray(target)) {
      return target.filter(
        (r): r is Record<string, unknown> => !!r && typeof r === 'object',
      );
    }
    if (target && typeof target === 'object') {
      if (!rootPath) {
        const arrays = Object.values(target as Record<string, unknown>).filter(
          Array.isArray,
        );
        if (arrays.length === 1) return arrays[0] as Record<string, unknown>[];
      }
      // Objeto único também é resposta legítima: fonte que devolve um cliente.
      return [target as Record<string, unknown>];
    }
    return [];
  }

  /** Traduz uma linha da fonte para os nossos campos. */
  private mapRow(
    source: AgentSourceRow,
    row: Record<string, unknown>,
  ): {
    phone?: string;
    name?: string;
    email?: string;
    externalId?: string;
    empresaId?: string;
    empresaNome?: string;
    variables: Record<string, unknown>;
  } {
    const map = source.field_map ?? {};

    const pick = (field: string): string | undefined => {
      const key = map[field];
      if (!key) return undefined;
      const value = resolveValue(key, row);
      if (value === null || value === undefined || value === '') return undefined;
      return String(value);
    };

    const variables: Record<string, unknown> = {};
    for (const [variable, key] of Object.entries(source.variables_map ?? {})) {
      const value = resolveValue(key, row);
      if (value !== null && value !== undefined && value !== '') {
        variables[variable] = value;
      }
    }

    return {
      phone: pick('phone'),
      name: pick('name'),
      email: pick('email'),
      externalId: pick('externalId'),
      // Campo de primeira classe separado de externalId (que identifica só o
      // CONTATO/pessoa) — antes ingest_agent_contact usava externalId pra
      // achar/criar a empresa também, e uma fonte que mapeia um código por
      // PESSOA (não por empresa) nesse campo fazia cada cliente virar sua
      // própria empresa (nome da empresa = nome do cliente). empresaId é a
      // chave certa pra companies, configurável separadamente no mapeamento
      // da fonte.
      empresaId: pick('empresaId'),
      empresaNome: pick('empresaNome'),
      variables,
    };
  }
}

function isSimplePath(path: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(path);
}

function resolveValue(spec: string, row: Record<string, unknown>): unknown {
  if (isSimplePath(spec)) {
    return readPath(row, spec);
  }
  return evalJsExpression(spec, row);
}

function evalJsExpression(expr: string, row: Record<string, unknown>): unknown {
  try {
    const upper = (s: unknown): string =>
      s == null ? '' : typeof s === 'string' ? s.toUpperCase() : String(s).toUpperCase();
    const lower = (s: unknown): string =>
      s == null ? '' : typeof s === 'string' ? s.toLowerCase() : String(s).toLowerCase();
    const trim = (s: unknown): string =>
      s == null ? '' : typeof s === 'string' ? s.trim() : String(s).trim();

    // Avaliador próprio (sem eval/new Function): a expressão é texto de admin
    // da conta e não pode executar código arbitrário no processo da API.
    const result = evalSafeExpression(expr, { ...row, upper, lower, trim });
    return result === null || result === undefined ? undefined : result;
  } catch {
    return undefined;
  }
}

function readPath(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      source,
    );
}
