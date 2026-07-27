import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420151000_crm_cron.sql.
export class CrmCron20260420151000 implements MigrationInterface {
  name = 'CrmCron20260420151000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
select public.schedule_edge_cron(
  'nexus-crm-sync-worker',
  '* * * * *',
  'crm-sync-worker',
  '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'CrmCron20260420151000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
