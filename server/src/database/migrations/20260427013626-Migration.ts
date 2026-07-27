import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427013626_b2b9ee05-cc41-4589-9bf8-094ec42fdaf5.sql.
export class Migration20260427013626 implements MigrationInterface {
  name = 'Migration20260427013626';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Bump default max_tokens for existing personas — 150 era curto demais e cortava frases no meio
UPDATE public.agent_personas
SET llm_max_tokens = 400
WHERE llm_max_tokens IS NULL OR llm_max_tokens < 200;
`);
    await queryRunner.query(`
-- Atualiza o default da coluna pra novas personas
ALTER TABLE public.agent_personas
ALTER COLUMN llm_max_tokens SET DEFAULT 400;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260427013626 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
