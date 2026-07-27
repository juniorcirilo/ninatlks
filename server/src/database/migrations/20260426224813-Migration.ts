import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426224813_3c5901dc-3676-42c5-8879-535e67c2173b.sql.
export class Migration20260426224813 implements MigrationInterface {
  name = 'Migration20260426224813';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE public.accounts
SET dialing_settings = jsonb_build_object(
  'timezone', COALESCE(dialing_settings->>'timezone', 'America/Sao_Paulo'),
  'allowed_hours_local', jsonb_build_object(
    'mon', jsonb_build_array(0, 24),
    'tue', jsonb_build_array(0, 24),
    'wed', jsonb_build_array(0, 24),
    'thu', jsonb_build_array(0, 24),
    'fri', jsonb_build_array(0, 24),
    'sat', jsonb_build_array(0, 24),
    'sun', jsonb_build_array(0, 24)
  ),
  'max_attempts_per_day', 999,
  'min_minutes_between_attempts', 0
)
WHERE dialing_settings IS NULL
   OR dialing_settings = '{}'::jsonb
   OR NOT (dialing_settings ? 'allowed_hours_local');
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426224813 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
