import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424000533_5858b740-52df-46c9-8e98-2d2c607211d2.sql.
export class Migration20260424000533 implements MigrationInterface {
  name = 'Migration20260424000533';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE accounts SET dialing_settings = jsonb_set(
  COALESCE(dialing_settings, '{}'::jsonb),
  '{allowed_hours_local}',
  '{"mon":[0,24],"tue":[0,24],"wed":[0,24],"thu":[0,24],"fri":[0,24],"sat":[0,24],"sun":[0,24]}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424000533 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
