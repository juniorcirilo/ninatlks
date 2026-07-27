import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420131000_calendar_cron.sql.
export class CalendarCron20260420131000 implements MigrationInterface {
  name = 'CalendarCron20260420131000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Meetings no-show detection runs every 5 min.
select public.schedule_edge_cron(
  'nexus-meetings-noshow-tick',
  '*/5 * * * *',
  'meetings-noshow-tick',
  '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'CalendarCron20260420131000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
