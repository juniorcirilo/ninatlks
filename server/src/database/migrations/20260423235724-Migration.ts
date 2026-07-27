import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423235724_34f3de76-dcc5-4aa5-9b68-3adc96e012a1.sql.
export class Migration20260423235724 implements MigrationInterface {
  name = 'Migration20260423235724';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.org_onboarding_state
  ADD COLUMN IF NOT EXISTS health_check_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_check_at timestamptz;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423235724 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
