import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423232213_f1198ece-d78b-43c1-82d3-4ff7451870fc.sql.
export class Migration20260423232213 implements MigrationInterface {
  name = 'Migration20260423232213';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- E7: Track when a campaign was canceled and how many calls had been placed at that point
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_after_placed integer,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_test_mode
  ON public.voice_campaigns (account_id, test_mode)
  WHERE test_mode = true;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423232213 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
