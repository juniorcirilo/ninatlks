import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260522170426_541207a9-fdce-4506-9630-368ea11c543b.sql.
export class Migration20260522170426 implements MigrationInterface {
  name = 'Migration20260522170426';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
SELECT cron.schedule(
  'voice-campaign-dispatch-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='https://atwafdaajixkmypkvsfb.supabase.co/functions/v1/voice-campaign-dispatch',
    headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0d2FmZGFhaml4a215cGt2c2ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NzM5MjMsImV4cCI6MjA5NDA0OTkyM30.WDY7bntTR8WCL_UmvHCMUl6woM6JvB3HKmsLWe2kl-U","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0d2FmZGFhaml4a215cGt2c2ZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NzM5MjMsImV4cCI6MjA5NDA0OTkyM30.WDY7bntTR8WCL_UmvHCMUl6woM6JvB3HKmsLWe2kl-U"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260522170426 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
