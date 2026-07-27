import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423231138_f1a03cc7-185d-46b5-8656-070b3f4917a9.sql.
export class Migration20260423231138 implements MigrationInterface {
  name = 'Migration20260423231138';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Add outcome categorization columns to voice_calls
ALTER TABLE public.voice_calls
  ADD COLUMN IF NOT EXISTS outcome_category text,
  ADD COLUMN IF NOT EXISTS outcome_confidence real,
  ADD COLUMN IF NOT EXISTS outcome_summary text,
  ADD COLUMN IF NOT EXISTS outcome_classified_at timestamptz;
`);
    await queryRunner.query(`
-- Constraint on allowed categories (drop first to make idempotent)
ALTER TABLE public.voice_calls
  DROP CONSTRAINT IF EXISTS voice_calls_outcome_category_check;
`);
    await queryRunner.query(`
ALTER TABLE public.voice_calls
  ADD CONSTRAINT voice_calls_outcome_category_check
  CHECK (outcome_category IS NULL OR outcome_category IN (
    'interested',
    'not_interested',
    'callback_requested',
    'voicemail',
    'wrong_number',
    'do_not_call',
    'no_answer',
    'busy',
    'failed',
    'escalated',
    'other'
  ));
`);
    await queryRunner.query(`
-- Partial index for analytics queries
CREATE INDEX IF NOT EXISTS idx_voice_calls_outcome_category
  ON public.voice_calls (account_id, outcome_category, outcome_classified_at DESC)
  WHERE outcome_category IS NOT NULL;
`);
    await queryRunner.query(`
-- Set replica identity full so realtime payloads include all columns
ALTER TABLE public.voice_calls REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
ALTER TABLE public.voice_campaign_contacts REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
-- Add to realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_calls;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_campaign_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_campaign_contacts;
  END IF;
END $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423231138 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
