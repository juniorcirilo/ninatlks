import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Client as PgClient } from 'pg';
import * as sql from 'mssql';
import { secretsBundle } from '../../common/llm/resolve-llm-config';
import {
  ToolSqlError,
  bindTenant,
  enforceTenantScope,
  type SqlDialect,
} from './tool-sql';

/** Chaves guardadas em account_secrets (provider = 'postgresql' | 'mssql'). */
export const DB_SECRET_KEYS = [
  'host',
  'port',
  'database',
  'user',
  'password',
  'ssl',
  'trust_cert',
  /** tenant do banco multi-tenant (coluna client_id) */
  'client_id',
] as const;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  /** SQL Server: aceitar certificado autoassinado */
  trustCert: boolean;
  /** valor do tenant (client_id) deste cliente no banco; vazio = não configurado */
  clientId: string;
}

export type Row = Record<string, unknown>;

export interface DbResult {
  rows: Row[];
  truncated: boolean;
}

const CONNECT_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 15_000;
const INTROSPECTION_LIMIT = 300;
const DEFAULT_PORT: Record<SqlDialect, number> = {
  postgresql: 5432,
  mssql: 1433,
};
const PG_SYSTEM = "('pg_catalog','information_schema')";

const truthy = (v?: string) =>
  ['true', '1', 'yes', 'sim'].includes((v ?? '').trim().toLowerCase());

/** Valores do banco → JSON seguro para devolver ao modelo. */
function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return '[binário]';
  return v;
}
const plainRow = (r: Row): Row =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)]));

interface Exec {
  text: string;
  values: unknown[];
  /** limite de linhas devolvidas */
  max: number;
  /** envolve em SELECT ... LIMIT (consultas montadas pelo agente) */
  wrap: boolean;
}

/**
 * Conexão com os bancos externos do cliente (PostgreSQL e SQL Server), cujas
 * credenciais ficam em Configurações → Integrações (Vault). SOMENTE LEITURA:
 * PostgreSQL roda em transação READ ONLY; SQL Server roda em transação que é
 * sempre desfeita (ROLLBACK). Uma conexão curta por operação.
 */
@Injectable()
export class ExternalDbService {
  constructor(private readonly dataSource: DataSource) {}

  async config(accountId: string, type: SqlDialect): Promise<DbConfig | null> {
    const b = await secretsBundle(this.dataSource, accountId, type);
    if (!b.host || !b.database || !b.user) return null;
    return {
      host: b.host.trim(),
      port: Number(b.port) || DEFAULT_PORT[type],
      database: b.database.trim(),
      user: b.user.trim(),
      password: b.password ?? '',
      ssl: truthy(b.ssl),
      trustCert: truthy(b.trust_cert),
      clientId: (b.client_id ?? '').trim(),
    };
  }

  private async need(accountId: string, type: SqlDialect): Promise<DbConfig> {
    const cfg = await this.config(accountId, type);
    if (!cfg)
      throw new Error(
        `Conexão ${type === 'mssql' ? 'SQL Server' : 'PostgreSQL'} não configurada em Configurações → Integrações.`,
      );
    return cfg;
  }

  /** Testa a conexão e devolve a versão do servidor. */
  async test(accountId: string, type: SqlDialect): Promise<string> {
    const cfg = await this.need(accountId, type);
    const r = await this.exec(type, cfg, {
      text:
        type === 'mssql' ? 'SELECT @@VERSION AS v' : 'SELECT version() AS v',
      values: [],
      max: 1,
      wrap: false,
    });
    return (
      String((r.rows[0]?.v as string | undefined) ?? '')
        .split('\n')[0]
        .slice(0, 120) || 'Conectado'
    );
  }

  /** Executa uma consulta JÁ VALIDADA (somente leitura) montada pelo agente. */
  async query(
    accountId: string,
    type: SqlDialect,
    sqlText: string,
    maxRows: number,
  ): Promise<DbResult> {
    const cfg = await this.need(accountId, type);
    // Banco multi-tenant: o tenant (client_id) vem da configuração, nunca do agente.
    if (!cfg.clientId)
      throw new ToolSqlError(
        'Client ID (tenant) não configurado em Configurações → Integrações; as consultas ficam bloqueadas até configurar.',
      );
    enforceTenantScope(sqlText);
    const bound = bindTenant(sqlText, type, cfg.clientId);
    return this.exec(type, cfg, {
      text: bound.text,
      values: bound.values,
      max: Math.max(1, Math.min(200, Math.floor(maxRows))),
      wrap: true,
    });
  }

  // ─── introspecção (consultas próprias, não vêm do agente) ──────────────

  async listTables(accountId: string, type: SqlDialect, search?: string) {
    const cfg = await this.need(accountId, type);
    const like = search?.trim() || null;
    return this.exec(type, cfg, {
      text:
        type === 'mssql'
          ? `SELECT TABLE_SCHEMA AS [schema], TABLE_NAME AS name, TABLE_TYPE AS type
               FROM INFORMATION_SCHEMA.TABLES
              WHERE (@p1 IS NULL OR TABLE_NAME LIKE '%' + @p1 + '%')
              ORDER BY 1, 2`
          : `SELECT table_schema AS schema, table_name AS name, table_type AS type
               FROM information_schema.tables
              WHERE table_schema NOT IN ${PG_SYSTEM}
                AND ($1::text IS NULL OR table_name ILIKE '%' || $1 || '%')
              ORDER BY 1, 2`,
      values: [like],
      max: INTROSPECTION_LIMIT,
      wrap: false,
    });
  }

  async describeTable(
    accountId: string,
    type: SqlDialect,
    table: string,
    schema?: string,
  ) {
    const cfg = await this.need(accountId, type);
    const sch = schema?.trim() || null;
    const mssql = type === 'mssql';
    const p = (n: number) => (mssql ? `@p${n}` : `$${n}`);
    const cast = mssql ? '' : '::text';
    const columns = await this.exec(type, cfg, {
      text: mssql
        ? `SELECT TABLE_SCHEMA AS [schema], COLUMN_NAME AS name, DATA_TYPE AS type,
                  IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS max_length
             FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @p1 AND (@p2 IS NULL OR TABLE_SCHEMA = @p2)
            ORDER BY TABLE_SCHEMA, ORDINAL_POSITION`
        : `SELECT table_schema AS schema, column_name AS name, data_type AS type,
                  is_nullable AS nullable, character_maximum_length AS max_length
             FROM information_schema.columns
            WHERE table_name = $1 AND ($2::text IS NULL OR table_schema = $2)
              AND table_schema NOT IN ${PG_SYSTEM}
            ORDER BY table_schema, ordinal_position`,
      values: [table, sch],
      max: INTROSPECTION_LIMIT,
      wrap: false,
    });
    const pk = await this.exec(type, cfg, {
      text: `SELECT kcu.column_name AS column_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
              WHERE tc.constraint_type = 'PRIMARY KEY'
                AND tc.table_name = ${p(1)}
                AND (${p(2)}${cast} IS NULL OR tc.table_schema = ${p(2)})`,
      values: [table, sch],
      max: 50,
      wrap: false,
    });
    const fk = await this.exec(type, cfg, {
      text: mssql
        ? `SELECT COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS [column],
                  OBJECT_SCHEMA_NAME(fkc.referenced_object_id) + '.' + OBJECT_NAME(fkc.referenced_object_id) AS ref_table,
                  COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_column
             FROM sys.foreign_key_columns fkc
            WHERE OBJECT_NAME(fkc.parent_object_id) = @p1`
        : `SELECT kcu.column_name AS column,
                  ccu.table_schema || '.' || ccu.table_name AS ref_table,
                  ccu.column_name AS ref_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1`,
      values: [table],
      max: 100,
      wrap: false,
    });
    return {
      columns: columns.rows,
      primary_key: pk.rows.map((r) => r.column_name),
      foreign_keys: fk.rows,
    };
  }

  async listProcedures(accountId: string, type: SqlDialect, search?: string) {
    const cfg = await this.need(accountId, type);
    const like = search?.trim() || null;
    return this.exec(type, cfg, {
      text:
        type === 'mssql'
          ? `SELECT ROUTINE_SCHEMA AS [schema], ROUTINE_NAME AS name, ROUTINE_TYPE AS type
               FROM INFORMATION_SCHEMA.ROUTINES
              WHERE (@p1 IS NULL OR ROUTINE_NAME LIKE '%' + @p1 + '%')
              ORDER BY 1, 2`
          : `SELECT routine_schema AS schema, routine_name AS name, routine_type AS type
               FROM information_schema.routines
              WHERE routine_schema NOT IN ${PG_SYSTEM}
                AND ($1::text IS NULL OR routine_name ILIKE '%' || $1 || '%')
              ORDER BY 1, 2`,
      values: [like],
      max: INTROSPECTION_LIMIT,
      wrap: false,
    });
  }

  /** Código-fonte da procedure/função (para o agente ENTENDER a lógica; não executa). */
  async procedureDefinition(
    accountId: string,
    type: SqlDialect,
    name: string,
    schema?: string,
  ) {
    const cfg = await this.need(accountId, type);
    const sch = schema?.trim() || null;
    return this.exec(type, cfg, {
      text:
        type === 'mssql'
          ? `SELECT TOP 3 ROUTINE_SCHEMA AS [schema], ROUTINE_NAME AS name,
                    OBJECT_DEFINITION(OBJECT_ID(QUOTENAME(ROUTINE_SCHEMA) + '.' + QUOTENAME(ROUTINE_NAME))) AS definition
               FROM INFORMATION_SCHEMA.ROUTINES
              WHERE ROUTINE_NAME = @p1 AND (@p2 IS NULL OR ROUTINE_SCHEMA = @p2)`
          : `SELECT n.nspname AS schema, p.proname AS name, pg_get_functiondef(p.oid) AS definition
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE p.proname = $1 AND ($2::text IS NULL OR n.nspname = $2)
                AND n.nspname NOT IN ${PG_SYSTEM} AND p.prokind IN ('f', 'p')
              LIMIT 3`,
      values: [name, sch],
      max: 3,
      wrap: false,
    });
  }

  // ─── execução ───────────────────────────────────────────────────────────

  private exec(type: SqlDialect, cfg: DbConfig, e: Exec): Promise<DbResult> {
    return type === 'mssql' ? this.execMssql(cfg, e) : this.execPg(cfg, e);
  }

  private async execPg(cfg: DbConfig, e: Exec): Promise<DbResult> {
    const client = new PgClient({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS + 2_000,
    });
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      // Disponibiliza o tenant para políticas RLS do cliente (current_setting('app.client_id')).
      if (cfg.clientId)
        await client.query("SELECT set_config('app.client_id', $1, true)", [
          cfg.clientId,
        ]);
      const text = e.wrap
        ? `SELECT * FROM (${e.text}) AS t LIMIT ${e.max + 1}`
        : e.text;
      const r = await client.query(text, e.values);
      await client.query('ROLLBACK');
      const rows = (r.rows as Row[]).map(plainRow);
      return { rows: rows.slice(0, e.max), truncated: rows.length > e.max };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  private async execMssql(cfg: DbConfig, e: Exec): Promise<DbResult> {
    const pool = await new sql.ConnectionPool({
      server: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      connectionTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: QUERY_TIMEOUT_MS,
      options: {
        encrypt: cfg.ssl,
        trustServerCertificate: cfg.trustCert,
        readOnlyIntent: true,
      },
    }).connect();
    try {
      const req = pool.request();
      e.values.forEach((v, i) => req.input(`p${i + 1}`, v));
      if (cfg.clientId) req.input('tenant', cfg.clientId);
      // Limita as linhas e desfaz qualquer efeito (a conexão é descartada).
      const r = await req.query(
        `SET ROWCOUNT ${e.max + 1}; BEGIN TRAN; ${
          cfg.clientId
            ? "EXEC sp_set_session_context N'client_id', @tenant; "
            : ''
        }${e.text}; ROLLBACK TRAN;`,
      );
      const rows = (r.recordset ?? []).map((x) => plainRow(x as Row));
      return { rows: rows.slice(0, e.max), truncated: rows.length > e.max };
    } finally {
      await pool.close().catch(() => undefined);
    }
  }
}
