import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Troca o antigo controle de "tamanho da resposta" (curta/média/longa,
 * mantido só internamente para limitar max_tokens) por um idioma de resposta
 * configurável: '' = mesmo idioma usado pelo cliente (padrão atual),
 * ou um idioma fixo (ex.: sempre em inglês, mesmo se o cliente escrever em
 * português).
 */
export class AiAgentReplyLanguage20261005080000 implements MigrationInterface {
  name = 'AiAgentReplyLanguage20261005080000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_settings
        add column if not exists reply_language text not null default ''
          check (reply_language in ('', 'pt-BR', 'en', 'es'));
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
          'reply_language', COALESCE(s.reply_language, ''),
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
    await queryRunner.query(`
      alter table public.ai_agent_settings
        drop column if exists reply_language;
    `);
  }
}
