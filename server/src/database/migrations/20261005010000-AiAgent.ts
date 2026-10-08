import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Página "Agente de IA" (OpenCode CLI): credenciais em account_secrets
 * (provider = 'ai-agent:opencode'), liga/desliga por conta, prompt
 * de sistema e skills de atendimento (entram no prompt).
 *
 *  - ai_agent_settings: 1 linha por conta (provedor ativo, liga/desliga global).
 *  - ai_agent_skills: skills de atendimento (instruções que entram no prompt).
 *  - ai_agent_runtime(): leitura SECURITY DEFINER para o motor de resposta, que
 *    roda fora de qualquer tenant (mesmo padrão de persona_auto_reply_context).
 */
export class AiAgent20261005010000 implements MigrationInterface {
  name = 'AiAgent20261005010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table public.ai_agent_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  active_provider text not null default 'opencode',
  enabled boolean not null default true,
  system_prompt text not null default '',
  temperature numeric(3,2) not null default 0.5,
  max_tokens integer not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create table public.ai_agent_skills (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  name text not null,
  description text not null,
  body text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, slug)
);
`);
    for (const t of ['ai_agent_settings', 'ai_agent_skills']) {
      await queryRunner.query(`alter table public.${t} enable row level security;`);
      await queryRunner.query(`alter table public.${t} force row level security;`);
      await queryRunner.query(`create policy "${t}_select_member" on public.${t}
         for select to authenticated
         using (is_account_member(auth.uid(), account_id))`);
      await queryRunner.query(`create policy "${t}_write_admin" on public.${t}
         for all to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))
         with check (has_role(auth.uid(), account_id, 'admin'::app_role))`);
      await queryRunner.query(`create trigger trg_${t}_updated_at before update on public.${t}
         for each row execute function public.tg_set_updated_at();`);
    }

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_runtime(_account_id uuid)
      RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT jsonb_build_object(
          'configured', s.account_id IS NOT NULL,
          'enabled', COALESCE(s.enabled, true),
          'active_provider', s.active_provider,
          'system_prompt', COALESCE(s.system_prompt, ''),
          'temperature', s.temperature,
          'max_tokens', s.max_tokens,
          'skills', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'slug', k.slug, 'name', k.name,
                     'description', k.description, 'body', k.body)
                   ORDER BY k.slug)
              FROM public.ai_agent_skills k
             WHERE k.account_id = _account_id AND k.enabled), '[]'::jsonb)
        )
        FROM (SELECT 1) one
        LEFT JOIN public.ai_agent_settings s ON s.account_id = _account_id;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ai_agent_runtime(uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.ai_agent_runtime(uuid) FROM PUBLIC;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.ai_agent_runtime(uuid);`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_agent_skills;`);
    await queryRunner.query(`DROP TABLE IF EXISTS public.ai_agent_settings;`);
  }
}
