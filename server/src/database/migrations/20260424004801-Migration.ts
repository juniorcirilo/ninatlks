import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424004801_1ded4513-6250-45b6-8c80-de2a96602a2a.sql.
export class Migration20260424004801 implements MigrationInterface {
  name = 'Migration20260424004801';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- 20260424010000_confidence_threshold_default_04.sql
-- Lower default confidence threshold for agent persona deployments from 0.7 to 0.4
-- so the AI replies more often. Existing rows still on the old default (0.7) get
-- bumped to 0.4; rows with custom values (0.5, 0.6, 0.8 etc.) are left intact.

ALTER TABLE public.agent_persona_deployments
  ALTER COLUMN confidence_threshold SET DEFAULT 0.4;
`);
    await queryRunner.query(`
UPDATE public.agent_persona_deployments
SET confidence_threshold = 0.4,
    updated_at = now()
WHERE confidence_threshold = 0.7;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424004801 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
