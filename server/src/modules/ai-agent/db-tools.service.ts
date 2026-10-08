import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { McpBackend, McpTool, McpToolResult } from './mcp-protocol';
import { ExternalDbService, type DbResult } from './external-db.service';
import {
  ToolSqlError,
  validateIdentifier,
  validateReadOnlySql,
  type SqlDialect,
} from './tool-sql';

export interface DbToolDef {
  slug: string;
  name: string;
  kind: 'database';
  connection: SqlDialect;
  description: string;
  max_rows: number;
}

export interface DbToolContext {
  accountId: string;
  conversationId: string | null;
  personaId: string | null;
}

const MAX_RESULT_CHARS = 8_000;
const ACTIONS = [
  'list_tables',
  'describe_table',
  'list_procedures',
  'get_procedure',
  'query',
] as const;
type Action = (typeof ACTIONS)[number];

/** Ferramentas habilitadas (conta + agente) para montar o MCP e o prompt. */
export async function loadDbTools(
  dataSource: DataSource,
  accountId: string,
  personaId: string | null,
): Promise<DbToolDef[]> {
  try {
    const [row] = await dataSource.query<{ t: DbToolDef[] }[]>(
      `SELECT public.ai_agent_tools_list($1, $2) AS t`,
      [accountId, personaId],
    );
    return row?.t ?? [];
  } catch (err) {
    // 42883 = migration AiAgentTools pendente: sem ferramentas.
    if ((err as { code?: string }).code === '42883') return [];
    throw err;
  }
}

/** Serializa linhas respeitando o teto de tamanho (corta no fim e marca). */
export function formatRows(r: DbResult): string {
  let rows = r.rows;
  let truncated = r.truncated;
  const build = () =>
    JSON.stringify({ row_count: rows.length, truncated, rows });
  let out = build();
  while (out.length > MAX_RESULT_CHARS && rows.length > 1) {
    rows = rows.slice(0, Math.max(1, Math.floor(rows.length / 2)));
    truncated = true;
    out = build();
  }
  return out.length > MAX_RESULT_CHARS
    ? `${out.slice(0, MAX_RESULT_CHARS)}…(cortado)`
    : out;
}

/**
 * Ferramentas de banco de dados do agente (somente leitura): o agente
 * inspeciona tabelas e procedures, monta a consulta e recebe o resultado.
 */
@Injectable()
export class DbToolsService {
  private readonly logger = new Logger(DbToolsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly db: ExternalDbService,
  ) {}

  /** Backend MCP para um token (conta/conversa/agente). */
  backendFor(ctx: DbToolContext): McpBackend {
    return {
      listTools: () => this.listTools(ctx),
      callTool: (name, args) => this.callTool(ctx, name, args),
    };
  }

  async listTools(ctx: DbToolContext): Promise<McpTool[]> {
    const tools = await loadDbTools(
      this.dataSource,
      ctx.accountId,
      ctx.personaId,
    );
    return tools.flatMap((t) => this.defsFor(t));
  }

  private defsFor(t: DbToolDef): McpTool[] {
    const dialect =
      t.connection === 'mssql'
        ? 'SQL Server (use TOP n, colchetes [ ] para nomes, funções T-SQL)'
        : 'PostgreSQL (use LIMIT n, aspas duplas para nomes, funções PostgreSQL)';
    const about = `Banco "${t.name}" — ${dialect}. SOMENTE LEITURA.${
      t.description ? ` Contexto do banco: ${t.description}` : ''
    }`;
    const str = (description: string) => ({ type: 'string', description });
    return [
      {
        name: `${t.slug}_list_tables`,
        description: `${about} Lista tabelas e views (schema, nome, tipo). Comece por aqui; use "search" para filtrar pelo nome.`,
        inputSchema: {
          type: 'object',
          properties: { search: str('trecho do nome da tabela (opcional)') },
          additionalProperties: false,
        },
      },
      {
        name: `${t.slug}_describe_table`,
        description: `${about} Mostra colunas (tipo, nulo), chave primária e chaves estrangeiras de uma tabela — use para descobrir como fazer JOIN.`,
        inputSchema: {
          type: 'object',
          properties: {
            table: str('nome da tabela'),
            schema: str('schema (opcional)'),
          },
          required: ['table'],
          additionalProperties: false,
        },
      },
      {
        name: `${t.slug}_list_procedures`,
        description: `${about} Lista procedures e funções (schema, nome, tipo).`,
        inputSchema: {
          type: 'object',
          properties: { search: str('trecho do nome (opcional)') },
          additionalProperties: false,
        },
      },
      {
        name: `${t.slug}_get_procedure`,
        description: `${about} Devolve o código-fonte de uma procedure/função para você ENTENDER a regra de negócio e montar a consulta. NÃO executa a procedure.`,
        inputSchema: {
          type: 'object',
          properties: {
            name: str('nome da procedure/função'),
            schema: str('schema (opcional)'),
          },
          required: ['name'],
          additionalProperties: false,
        },
      },
      {
        name: `${t.slug}_query`,
        description: `${about} Executa UMA consulta SELECT que você montou (máx. ${t.max_rows} linhas; o resultado é cortado se exceder). Antes, inspecione tabelas/colunas. O banco é MULTI-TENANT (tenant = coluna client_id): TODA consulta deve conter o parâmetro :client_id (ex.: WHERE t.client_id = :client_id) — escreva literalmente ":client_id", o sistema preenche o valor; nunca escreva o valor do tenant. Filtre também pelo cliente desta conversa e peça só as colunas necessárias. Erros voltam como texto para você corrigir a consulta.`,
        inputSchema: {
          type: 'object',
          properties: {
            sql: str(
              'consulta SELECT (ou WITH ... SELECT), sem ponto e vírgula no meio',
            ),
          },
          required: ['sql'],
          additionalProperties: false,
        },
      },
    ];
  }

  async callTool(
    ctx: DbToolContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const action = ACTIONS.find((a) => name.endsWith(`_${a}`));
    if (!action)
      return { text: `Ferramenta desconhecida: ${name}`, isError: true };
    const slug = name.slice(0, -(action.length + 1));
    const tools = await loadDbTools(
      this.dataSource,
      ctx.accountId,
      ctx.personaId,
    );
    const tool = tools.find((t) => t.slug === slug);
    if (!tool)
      return { text: `Ferramenta desconhecida: ${name}`, isError: true };

    const str = (k: string): string | undefined =>
      typeof args[k] === 'string' ? args[k] : undefined;
    let detail = '';
    try {
      let text: string;
      let rowCount = 0;
      switch (action) {
        case 'list_tables': {
          detail = str('search') ?? '';
          const r = await this.db.listTables(
            ctx.accountId,
            tool.connection,
            detail,
          );
          rowCount = r.rows.length;
          text = formatRows(r);
          break;
        }
        case 'describe_table': {
          const table = validateIdentifier(str('table') ?? '', 'Tabela');
          const schema = str('schema')
            ? validateIdentifier(str('schema')!, 'Schema')
            : undefined;
          detail = `${schema ? `${schema}.` : ''}${table}`;
          const d = await this.db.describeTable(
            ctx.accountId,
            tool.connection,
            table,
            schema,
          );
          rowCount = d.columns.length;
          if (!d.columns.length)
            return this.done(ctx, tool, action, detail, 0, null, {
              text: `Tabela "${detail}" não encontrada. Use list_tables para ver os nomes.`,
              isError: true,
            });
          text = JSON.stringify(d).slice(0, MAX_RESULT_CHARS);
          break;
        }
        case 'list_procedures': {
          detail = str('search') ?? '';
          const r = await this.db.listProcedures(
            ctx.accountId,
            tool.connection,
            detail,
          );
          rowCount = r.rows.length;
          text = formatRows(r);
          break;
        }
        case 'get_procedure': {
          const pname = validateIdentifier(str('name') ?? '', 'Procedure');
          const schema = str('schema')
            ? validateIdentifier(str('schema')!, 'Schema')
            : undefined;
          detail = `${schema ? `${schema}.` : ''}${pname}`;
          const r = await this.db.procedureDefinition(
            ctx.accountId,
            tool.connection,
            pname,
            schema,
          );
          rowCount = r.rows.length;
          text = JSON.stringify(r.rows).slice(0, MAX_RESULT_CHARS);
          break;
        }
        case 'query': {
          const sqlText = validateReadOnlySql(
            str('sql') ?? '',
            tool.connection,
          );
          detail = sqlText;
          const r = await this.db.query(
            ctx.accountId,
            tool.connection,
            sqlText,
            tool.max_rows,
          );
          rowCount = r.rows.length;
          text = formatRows(r);
          break;
        }
      }
      return this.done(ctx, tool, action, detail, rowCount, null, { text });
    } catch (err) {
      const msg =
        err instanceof ToolSqlError
          ? err.message
          : `Erro do banco: ${(err as Error).message}`.slice(0, 400);
      return this.done(ctx, tool, action, detail, null, msg, {
        text: msg,
        isError: true,
      });
    }
  }

  /** Registra a operação (auditoria) e devolve o resultado. */
  private async done(
    ctx: DbToolContext,
    tool: DbToolDef,
    action: Action,
    detail: string,
    rowCount: number | null,
    error: string | null,
    result: McpToolResult,
  ): Promise<McpToolResult> {
    try {
      await this.dataSource.query(
        `SELECT public.ai_agent_log_query($1,$2,$3,$4,$5,$6,$7)`,
        [
          ctx.accountId,
          ctx.conversationId,
          tool.slug,
          action,
          detail,
          rowCount,
          error,
        ],
      );
    } catch (err) {
      this.logger.warn(`audit log: ${(err as Error).message}`);
    }
    return result;
  }
}
