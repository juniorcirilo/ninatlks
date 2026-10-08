import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ferramentas do agente (skills-tool). A primeira: acesso SOMENTE LEITURA a
 * um banco externo do cliente (PostgreSQL / SQL Server), cujas credenciais
 * ficam em account_secrets (provider 'postgresql' | 'mssql'). O agente
 * (via MCP) inspeciona tabelas/procedures, monta a consulta e traz o resultado.
 *
 *  - ai_agent_tools: a ferramenta (persona_id NULL = conta toda).
 *  - ai_agent_tool_get / ai_agent_tools_list: leituras SECURITY DEFINER para o
 *    servidor MCP, que roda fora de qualquer tenant.
 *  - ai_agent_query_log: auditoria de cada consulta do agente.
 */
export class AiAgentTools20261005040000 implements MigrationInterface {
  name = 'AiAgentTools20261005040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table public.ai_agent_tools (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  persona_id uuid references public.agent_personas(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z][a-z0-9_]{0,23}$'),
  name text not null,
  kind text not null default 'database' check (kind in ('database')),
  connection text not null check (connection in ('postgresql', 'mssql')),
  description text not null default '',
  max_rows integer not null default 50 check (max_rows between 1 and 200),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, slug)
);
`);
    await queryRunner.query(`
      create index ai_agent_tools_persona_idx
        on public.ai_agent_tools(persona_id) where persona_id is not null;
    `);
    await queryRunner.query(`
create table public.ai_agent_query_log (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid,
  tool_slug text not null,
  action text not null,
  detail text,
  row_count integer,
  error text,
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
      create index ai_agent_query_log_account_idx
        on public.ai_agent_query_log(account_id, created_at desc);
    `);

    for (const t of ['ai_agent_tools', 'ai_agent_query_log']) {
      await queryRunner.query(`alter table public.${t} enable row level security;`);
      await queryRunner.query(`alter table public.${t} force row level security;`);
      await queryRunner.query(`create policy "${t}_select_member" on public.${t}
         for select to authenticated
         using (is_account_member(auth.uid(), account_id))`);
    }
    await queryRunner.query(`create policy "ai_agent_tools_write_admin" on public.ai_agent_tools
       for all to authenticated
       using (has_role(auth.uid(), account_id, 'admin'::app_role))
       with check (has_role(auth.uid(), account_id, 'admin'::app_role))`);
    await queryRunner.query(`create trigger trg_ai_agent_tools_updated_at
       before update on public.ai_agent_tools
       for each row execute function public.tg_set_updated_at();`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_tools_list(_account_id uuid, _persona_id uuid)
      RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'slug', t.slug, 'name', t.name, 'kind', t.kind,
                 'connection', t.connection, 'description', t.description,
                 'max_rows', t.max_rows)
               ORDER BY t.slug), '[]'::jsonb)
          FROM public.ai_agent_tools t
         WHERE t.account_id = _account_id AND t.enabled
           AND (t.persona_id IS NULL OR t.persona_id = _persona_id);
      $$;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_log_query(
        _account_id uuid, _conversation_id uuid, _tool_slug text,
        _action text, _detail text, _row_count int, _error text
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.ai_agent_query_log
          (account_id, conversation_id, tool_slug, action, detail, row_count, error)
        VALUES (_account_id, _conversation_id, _tool_slug, _action,
                left(_detail, 4000), _row_count, left(_error, 1000));
      $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ai_agent_tools_list(uuid, uuid) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.ai_agent_log_query(uuid, uuid, text, text, text, int, text) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.ai_agent_tools_list(uuid, uuid) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.ai_agent_log_query(uuid, uuid, text, text, text, int, text) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ai_agent_log_query(uuid, uuid, text, text, text, int, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ai_agent_tools_list(uuid, uuid);`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_agent_query_log;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_agent_tools;`);
  }
}
