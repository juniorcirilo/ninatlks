/**
 * Thin PostgreSQL helper — replaces supabaseAdmin for server-side code.
 */

import { Pool } from "pg";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function getOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Mesmo que `query()`, mas roda dentro de uma transação com
 * `app.current_user_id`/`app.current_account_id` setados via `set_config`
 * (escopo local à transação — some sozinho no COMMIT/ROLLBACK, então não
 * vaza pra próxima query que pegar essa conexão de volta do pool). É o
 * equivalente, para as server functions do frontend, do que
 * TenantContextInterceptor já faz para toda requisição do backend NestJS —
 * necessário porque tabelas com FORCE ROW LEVEL SECURITY (companies,
 * cobranca_titulos, orcamentos_erp) exigem esse contexto pra `is_account_member`
 * autorizar a query; sem ele, a policy nega e a query some (zero linhas),
 * mesmo vindo do dono da tabela.
 *
 * `userId`/`accountId` DEVEM vir de `context` (requireSessionAuth), nunca de
 * `data` — são exatamente o que a RLS está verificando.
 */
export async function queryAsAccount<T = any>(
  userId: string,
  accountId: string,
  text: string,
  params?: any[],
): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_user_id', $1, true), set_config('app.current_account_id', $2, true)`,
      [userId, accountId],
    );
    const result = await client.query(text, params);
    await client.query("COMMIT");
    return result.rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function getOneAsAccount<T = any>(
  userId: string,
  accountId: string,
  text: string,
  params?: any[],
): Promise<T | null> {
  const rows = await queryAsAccount<T>(userId, accountId, text, params);
  return rows[0] ?? null;
}

export async function insert<T = any>(table: string, data: Record<string, any>): Promise<T[]> {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`;
  return query<T>(sql, values);
}

export async function updateById<T = any>(
  table: string,
  id: string,
  data: Record<string, any>,
): Promise<T | null> {
  const sets = Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = [id, ...Object.values(data)];
  const sql = `UPDATE ${table} SET ${sets} WHERE id = $1 RETURNING *`;
  const rows = await query<T>(sql, values);
  return rows[0] ?? null;
}

export async function deleteById(table: string, id: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

// Supabase-compatible shim for files that already used .from().select() chains.
// Types are loose to avoid breaking existing code patterns.

export const supabaseAdmin = {
  async query<T = any>(text: string, params: any[] = []): Promise<{ data: T[]; error: null }> {
    const rows = await query<T>(text, params);
    return { data: rows, error: null };
  },

  from(table: string) {
    return {
      select: (cols: string) => ({
        eq: (col: string, val: any) => ({
          neq: (col: string, val: any) => ({}),
          gt: (col: string, val: any) => ({}),
          gte: (col: string, val: any) => ({}),
          lt: (col: string, val: any) => ({}),
          lte: (col: string, val: any) => ({}),
          in: (col: string, val: any[]) => ({}),
          is: (col: string, val: any) => ({}),
          or: (cond: string) => ({}),
          order: (col: string, opts?: any) => ({}),
          limit: (n: number) => ({
            maybeSingle: async (): Promise<{ data: any; error: null }> => {
              const rows = await query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT $2`, [val, n]);
              return { data: rows[0] ?? null, error: null };
            },
            single: async (): Promise<{ data: any; error: null }> => {
              const rows = await query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT $2`, [val, n]);
              if (rows.length === 0) throw new Error("No rows");
              return { data: rows[0], error: null };
            },
          }),
          maybeSingle: async (): Promise<{ data: any; error: null }> => {
            const rows = await query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT 1`, [val]);
            return { data: rows[0] ?? null, error: null };
          },
          single: async (): Promise<{ data: any; error: null }> => {
            const rows = await query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT 1`, [val]);
            if (rows.length === 0) throw new Error("No rows");
            return { data: rows[0], error: null };
          },
        }),
        limit: (n: number) => ({
          maybeSingle: async (): Promise<{ data: any; error: null }> => {
            const rows = await query(`SELECT ${cols} FROM ${table} LIMIT $1`, [n]);
            return { data: rows[0] ?? null, error: null };
          },
        }),
      }),
      insert: async (rows: any[]) => {
        if (rows.length === 0) return { data: [], error: null };
        const keys = Object.keys(rows[0]);
        const values = rows.flatMap(r => keys.map(k => r[k]));
        const placeholders = rows.map((_, i) => {
          const start = i * keys.length + 1;
          return keys.map((_, j) => `$${start + j}`).join(", ");
        }).join("), (");
        const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders}) RETURNING *`;
        const result = await query(sql, values);
        return { data: result, error: null };
      },
      update: (data: Record<string, any>) => ({
        eq: (col: string, val: any) => ({
          maybeSingle: async (): Promise<{ data: any; error: null }> => {
            const sets = Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(", ");
            const values = [val, ...Object.values(data)];
            const sql = `UPDATE ${table} SET ${sets} WHERE ${col} = $1 RETURNING *`;
            const rows = await query(sql, values);
            return { data: rows[0] ?? null, error: null };
          },
          single: async (): Promise<{ data: any; error: null }> => {
            const sets = Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(", ");
            const values = [val, ...Object.values(data)];
            const sql = `UPDATE ${table} SET ${sets} WHERE ${col} = $1 RETURNING *`;
            const rows = await query(sql, values);
            if (rows.length === 0) throw new Error("No rows");
            return { data: rows[0], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (col: string, val: any) => ({
          maybeSingle: async (): Promise<{ data: any; error: null }> => {
            const sql = `DELETE FROM ${table} WHERE ${col} = $1 RETURNING *`;
            const rows = await query(sql, [val]);
            return { data: rows[0] ?? null, error: null };
          },
        }),
      }),
    };
  },

  rpc: async (name: string, args?: Record<string, any>) => {
    if (name === "list_account_secrets") {
      const data = await query(
        `SELECT provider, key_name, updated_at FROM account_secrets WHERE account_id = $1 ORDER BY provider, key_name`,
        [args?.p_account_id]
      );
      return { data, error: null };
    }
    if (name === "set_account_secret") {
      const data = await query(
        `INSERT INTO account_secrets (account_id, provider, key_name, value, metadata) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, provider, key_name) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, updated_at = now()
         RETURNING *`,
        [args?.p_account_id, args?.p_provider, args?.p_key_name, args?.p_value, args?.p_metadata || {}]
      );
      return { data: data[0], error: null };
    }
    if (name === "delete_account_secret") {
      const data = await query(
        `DELETE FROM account_secrets WHERE account_id = $1 AND provider = $2 AND key_name = $3 RETURNING *`,
        [args?.p_account_id, args?.p_provider, args?.p_key_name]
      );
      return { data: data[0], error: null };
    }
    if (name === "lead_classify_from_call") {
      const data = await query(`SELECT * FROM classify_lead_from_call($1)`, [args?.voice_call_id]);
      return { data: data[0], error: null };
    }
    if (name === "cadence_enroll_contact") {
      const data = await query(`SELECT * FROM cadence_enroll_contact($1, $2)`, [args?.p_contact_id, args?.p_cadence_id]);
      return { data: data[0], error: null };
    }
    throw new Error(`RPC ${name} not implemented in pg fallback`);
  },

  functions: {
    invoke: async (name: string, opts?: { body?: any }) => {
      const API_URL = process.env.VITE_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
      const res = await fetch(`${API_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Function ${name} failed: ${res.status} ${text}`);
      }
      const data = await res.json().catch(() => ({}));
      return { data, error: null };
    },
  },

  channel: (name: string) => ({
    on: (event: string, opts: { schema: string; event: string }, callback: (payload: any) => void) => {
      return { unsubscribe: () => {} };
    },
  }),
};
