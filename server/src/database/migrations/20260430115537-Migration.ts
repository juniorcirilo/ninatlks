import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260430115537_7da19c2d-7a19-4c9c-912f-d2dd0589dde8.sql.
export class Migration20260430115537 implements MigrationInterface {
  name = 'Migration20260430115537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE public.voice_calls
SET ended_at = COALESCE(
  (metadata->>'finalized_at')::timestamptz,
  (metadata->>'last_finalize_attempt')::timestamptz,
  started_at + (COALESCE(duration_seconds, 0) || ' seconds')::interval,
  updated_at
)
WHERE ended_at IS NULL
  AND status IN ('completed','failed','busy','no_answer','canceled');
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260430115537 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
