import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260429194235_6c6affef-ab9f-439f-aa02-856571f75718.sql.
export class Migration20260429194235 implements MigrationInterface {
  name = 'Migration20260429194235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
SELECT cron.unschedule('voice-calls-finalize-pending');
`);
    await queryRunner.query(`
SELECT cron.schedule(
  'voice-calls-finalize-pending',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--975b0cb1-8180-4007-a7ad-ebcba2bc4122-dev.lovable.app/api/public/hooks/voice-calls-finalize-pending',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260429194235 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
