import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comportamento do Agente de IA (OpenCode): esforço (variant), tamanho da
 * resposta, turnos de contexto e modelos de fallback (tentados em ordem quando
 * o modelo principal falha). temperature já existe em ai_agent_settings.
 */
export class AiAgentBehavior20261005020000 implements MigrationInterface {
  name = 'AiAgentBehavior20261005020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_settings
        add column if not exists effort text not null default '',
        add column if not exists reply_length text not null default 'curta'
          check (reply_length in ('curta', 'media', 'longa')),
        add column if not exists history_turns integer not null default 8
          check (history_turns between 1 and 30),
        add column if not exists fallback_models text[] not null default '{}';
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
             WHERE k.account_id = _account_id AND k.enabled), '[]'::jsonb)
        )
        FROM (SELECT 1) one
        LEFT JOIN public.ai_agent_settings s ON s.account_id = _account_id;
      $$;
    `);

    // Contexto da conversa com tamanho configurável (persona_auto_reply_context
    // devolve só as 8 últimas).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ai_agent_recent_messages(_conversation_id uuid, _limit int)
      RETURNS jsonb
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at ASC), '[]'::jsonb)
          FROM (
            SELECT sender_type, content, created_at
              FROM public.messages
             WHERE conversation_id = _conversation_id AND private = false
             ORDER BY created_at DESC
             LIMIT GREATEST(1, LEAST(COALESCE(_limit, 8), 30))
          ) t;
      $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ai_agent_recent_messages(uuid, int) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.ai_agent_recent_messages(uuid, int) FROM PUBLIC;`,
    );
  }

  // (acrescentado ao up abaixo)
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ai_agent_recent_messages(uuid, int);`,
    );
    await queryRunner.query(`
      alter table public.ai_agent_settings
        drop column if exists fallback_models,
        drop column if exists history_turns,
        drop column if exists reply_length,
        drop column if exists effort;
    `);
  }
}
