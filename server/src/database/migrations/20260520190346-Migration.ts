import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260520190346_ba115a82-9774-47d7-9cdd-88b18f322866.sql.
export class Migration20260520190346 implements MigrationInterface {
  name = 'Migration20260520190346';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS retry_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
`);
    await queryRunner.query(`
COMMENT ON COLUMN public.voice_campaigns.retry_rules IS
  'Per-outcome retry config: { "no_answer": {"max_attempts":3,"delay_minutes":60}, ... }. Empty = use campaign-level retry_attempts/retry_delay_minutes.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260520190346 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
