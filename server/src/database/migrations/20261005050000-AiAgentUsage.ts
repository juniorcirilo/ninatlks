import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Uso e consumo do Agente de IA (dashboard): uma linha por chamada ao
 * OpenCode (resposta no chat, geração de skill, teste), com tokens, custo,
 * latência, modelo que respondeu e quantos fallbacks foram necessários.
 */
export class AiAgentUsage20261005050000 implements MigrationInterface {
  name = 'AiAgentUsage20261005050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table public.ai_agent_usage (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  conversation_id uuid,
  persona_id uuid,
  kind text not null check (kind in ('reply', 'skill_gen', 'test')),
  provider text not null default 'opencode' check (provider in ('opencode', 'legacy')),
  model text,
  ok boolean not null,
  fallback_count integer not null default 0,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  tokens_reasoning integer not null default 0,
  tokens_cache integer not null default 0,
  cost numeric(12, 6) not null default 0,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
      create index ai_agent_usage_account_idx
        on public.ai_agent_usage(account_id, created_at desc);
    `);
    await queryRunner.query(
      `alter table public.ai_agent_usage enable row level security;`,
    );
    await queryRunner.query(
      `alter table public.ai_agent_usage force row level security;`,
    );
    await queryRunner.query(`create policy "ai_agent_usage_select_member" on public.ai_agent_usage
       for select to authenticated
       using (is_account_member(auth.uid(), account_id))`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_log_usage(
        _account_id uuid, _conversation_id uuid, _persona_id uuid, _kind text,
        _provider text, _model text, _ok boolean, _fallback_count int,
        _tokens_in int, _tokens_out int, _tokens_reasoning int, _tokens_cache int,
        _cost numeric, _duration_ms int, _error text
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.ai_agent_usage
          (account_id, conversation_id, persona_id, kind, provider, model, ok,
           fallback_count, tokens_in, tokens_out, tokens_reasoning, tokens_cache,
           cost, duration_ms, error)
        VALUES (_account_id, _conversation_id, _persona_id, _kind, _provider, _model, _ok,
                COALESCE(_fallback_count, 0), COALESCE(_tokens_in, 0), COALESCE(_tokens_out, 0),
                COALESCE(_tokens_reasoning, 0), COALESCE(_tokens_cache, 0),
                COALESCE(_cost, 0), _duration_ms, left(_error, 500));
      $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ai_agent_log_usage(uuid, uuid, uuid, text, text, text, boolean, int, int, int, int, int, numeric, int, text) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.ai_agent_log_usage(uuid, uuid, uuid, text, text, text, boolean, int, int, int, int, int, numeric, int, text) FROM PUBLIC;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ai_agent_log_usage(uuid, uuid, uuid, text, text, text, boolean, int, int, int, int, int, numeric, int, text);`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_agent_usage;`);
  }
}
