// Acesso do agente a bancos externos: SOMENTE LEITURA.
//
// O agente inspeciona tabelas/procedures e monta a própria consulta. Esta
// validação é uma camada (a outra é o banco: transação READ ONLY e, de
// preferência, um usuário de banco só com SELECT): aceita um único SELECT/WITH
// sem comandos de escrita, execução de procedures ou objetos de sistema.

/** Banco externo (credenciais em Configurações → Integrações). */
export type SqlDialect = 'postgresql' | 'mssql';
export const SQL_DIALECTS: SqlDialect[] = ['postgresql', 'mssql'];

export class ToolSqlError extends Error {}

const MAX_SQL_LENGTH = 8000;

const FORBIDDEN = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'execute',
  'prepare',
  'vacuum',
  'analyze',
  'set',
  'reset',
  'listen',
  'notify',
  'lock',
  'merge',
  'refresh',
  'reindex',
  'cluster',
  'comment',
  'security',
  'set_config',
  'pg_sleep',
  'pg_read_[a-z_]+',
  'pg_ls_[a-z_]+',
  'pg_file_[a-z_]+',
  'pg_stat_file',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'lo_import',
  'lo_export',
  'dblink[a-z_]*',
  'into',
];
// T-SQL: execução de procedimentos, fontes externas e controle de fluxo.
const FORBIDDEN_MSSQL = [
  'exec',
  'sp_[a-z0-9_]+',
  'xp_[a-z0-9_]+',
  'openrowset',
  'opendatasource',
  'openquery',
  'bulk',
  'shutdown',
  'waitfor',
  'kill',
  'backup',
  'restore',
  'use',
  'declare',
  'dbcc',
];
const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN.join('|')})\\b`, 'i');
const FORBIDDEN_MSSQL_RE = new RegExp(
  `\\b(${FORBIDDEN_MSSQL.join('|')})\\b`,
  'i',
);
// Segredos e credenciais (a introspecção é feita pelas ferramentas próprias).
const SENSITIVE_RE =
  /\b(vault|account_secrets|pg_authid|pg_shadow|pg_user_mapping|auth\.users|api_keys|syslogins|sql_logins)\b/i;

/** Texto com literais de string neutralizados. */
function stripStrings(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Valida a consulta montada pelo agente. Devolve o SQL normalizado (sem `;`
 * final) ou lança ToolSqlError com a causa (devolvida ao agente para corrigir).
 */
export function validateReadOnlySql(
  sqlIn: string,
  dialect: SqlDialect,
): string {
  let sql = sqlIn.trim();
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();
  if (!sql) throw new ToolSqlError('Informe a consulta SQL.');
  if (sql.length > MAX_SQL_LENGTH)
    throw new ToolSqlError(
      `Consulta grande demais (máx. ${MAX_SQL_LENGTH} caracteres).`,
    );
  if (!/^(select|with)\b/i.test(sql))
    throw new ToolSqlError('Somente consultas SELECT (ou WITH ... SELECT).');
  const bare = stripStrings(sql);
  if (bare.includes(';'))
    throw new ToolSqlError('Envie uma única consulta (sem ";" no meio).');
  if (/--|\/\*/.test(bare))
    throw new ToolSqlError('Comentários SQL não são permitidos.');
  const bad = FORBIDDEN_RE.exec(bare);
  if (bad)
    throw new ToolSqlError(
      `Acesso somente leitura: ${bad[1].toUpperCase()} não é permitido.`,
    );
  if (dialect === 'mssql') {
    const t = FORBIDDEN_MSSQL_RE.exec(bare);
    if (t)
      throw new ToolSqlError(
        `Acesso somente leitura: ${t[1].toUpperCase()} não é permitido no SQL Server.`,
      );
  }
  const sens = SENSITIVE_RE.exec(bare);
  if (sens) throw new ToolSqlError(`Objeto não permitido: ${sens[1]}.`);
  return sql;
}

/** Identificador simples (schema/tabela/procedure) vindo do agente. */
export function validateIdentifier(name: string, what: string): string {
  const n = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_$ ]{0,127}$/.test(n))
    throw new ToolSqlError(`${what} inválido.`);
  return n;
}

// ─── tenant (client_id) ───────────────────────────────────────────────────
//
// O banco do cliente é multi-tenant e o tenant é o `client_id`. O agente nunca
// escolhe o valor: escreve o parâmetro `:client_id` e o servidor injeta o do
// tenant configurado em Integrações. A consulta é recusada se não usar o
// parâmetro ou se comparar `client_id` com um valor fixo.

const TENANT_PARAM_RE = /(?<![:\w]):client_id\b/g;
// client_id <op> literal/número/lista  ou  literal <op> client_id
const TENANT_LITERAL_RE =
  /\bclient_id\b\s*(?:=|<>|!=|<=|>=|<|>|\bin\b|\blike\b|\bbetween\b)\s*(?:['"\d(-])|(?:['"\d])\s*(?:=|<>|!=)\s*[\w.]*\bclient_id\b/i;

/** Garante que a consulta é restrita ao tenant via `:client_id`. */
export function enforceTenantScope(sql: string): void {
  const bare = stripStrings(sql);
  if (!new RegExp(TENANT_PARAM_RE.source).test(bare))
    throw new ToolSqlError(
      'Banco multi-tenant: a consulta deve filtrar pelo tenant com o parâmetro :client_id (ex.: WHERE t.client_id = :client_id). O sistema preenche o valor.',
    );
  if (TENANT_LITERAL_RE.test(bare))
    throw new ToolSqlError(
      'Não compare client_id com um valor fixo: use somente o parâmetro :client_id.',
    );
}

/** Troca `:client_id` pelo parâmetro do dialeto ($1 / @p1), preservando literais. */
export function bindTenant(
  sql: string,
  dialect: SqlDialect,
  clientId: string,
): { text: string; values: unknown[] } {
  const ph = dialect === 'mssql' ? '@p1' : '$1';
  let out = '';
  let last = 0;
  for (const m of sql.matchAll(/'(?:[^']|'')*'|(?<![:\w]):client_id\b/g)) {
    out += sql.slice(last, m.index);
    out += m[0].startsWith("'") ? m[0] : ph;
    last = (m.index ?? 0) + m[0].length;
  }
  out += sql.slice(last);
  return { text: out, values: [clientId] };
}
