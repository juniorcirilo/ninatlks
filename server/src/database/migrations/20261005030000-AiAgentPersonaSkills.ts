import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Skills por agente: ao criar um agente (página Agentes de voz) o OpenCode gera
 * uma skill a partir da descrição, ligada ao agente (persona_id). Skills sem
 * persona_id continuam sendo da conta toda.
 *
 *  - ai_agent_runtime(): passa a devolver só as skills da conta (persona_id IS NULL).
 *  - ai_agent_persona_skills(): skills habilitadas de um agente, para a resposta.
 */
export class AiAgentPersonaSkills20261005030000 implements MigrationInterface {
  name = 'AiAgentPersonaSkills20261005030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_skills
        add column if not exists persona_id uuid
          references public.agent_personas(id) on delete cascade;
    `);
    await queryRunner.query(`
      create index if not exists ai_agent_skills_persona_idx
        on public.ai_agent_skills(persona_id) where persona_id is not null;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_runtime(_account_id uuid)
      RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT jsonb_build_object(
          'configured', s.account_id IS NOT NULL,
          'enabled', COALESCE(s.enabled, true),
          'system_prompt', COALESCE(s.system_prompt, ''),
          'temperature', s.temperature,
          'effort', COALESCE(s.effort, ''),
          'reply_length', COALESCE(s.reply_length, 'curta'),
          'history_turns', COALESCE(s.history_turns, 8),
          'fallback_models', COALESCE(to_jsonb(s.fallback_models), '[]'::jsonb),
          'skills', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                     'slug', k.slug, 'name', k.name,
                     'description', k.description, 'body', k.body)
                   ORDER BY k.slug)
              FROM public.ai_agent_skills k
             WHERE k.account_id = _account_id AND k.enabled
               AND k.persona_id IS NULL), '[]'::jsonb)
        )
        FROM (SELECT 1) one
        LEFT JOIN public.ai_agent_settings s ON s.account_id = _account_id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_persona_skills(_account_id uuid, _persona_id uuid)
      RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'slug', k.slug, 'name', k.name,
                 'description', k.description, 'body', k.body)
               ORDER BY k.slug), '[]'::jsonb)
          FROM public.ai_agent_skills k
         WHERE k.account_id = _account_id AND k.enabled AND k.persona_id = _persona_id;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ai_agent_persona_skills(uuid, uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.ai_agent_persona_skills(uuid, uuid) FROM PUBLIC;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ai_agent_persona_skills(uuid, uuid);`,
    );
    await queryRunner.query(`
      alter table public.ai_agent_skills drop column if exists persona_id;
    `);
  }
}
