import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424000751_6a7b3c15-ee5a-4c57-8be0-309b7cc553f8.sql.
export class Migration20260424000751 implements MigrationInterface {
  name = 'Migration20260424000751';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE accounts SET dialing_settings = 
  jsonb_set(
    jsonb_set(
      COALESCE(dialing_settings, '{}'::jsonb),
      '{min_minutes_between_attempts}', '0'::jsonb
    ),
    '{max_attempts_per_day}', '999'::jsonb
  );
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424000751 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
