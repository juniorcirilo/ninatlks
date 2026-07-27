import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420110000_workflow_crons.sql.
export class WorkflowCrons20260420110000 implements MigrationInterface {
  name = 'WorkflowCrons20260420110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Workflow engine periodic jobs:
--   1. workflow-execute every minute to mop up runs that ingest couldn't
--      deliver synchronously (either due to fire-and-forget timeout or high
--      concurrency). Safety net.
--   2. workflow-cron-tick every minute to fire scheduled workflows.
--   3. A job that also invokes workflow-execute after DB trigger events
--      land in workflow_events (since our DB triggers don't call pg_net).

select public.schedule_edge_cron(
  'nexus-workflow-execute',
  '* * * * *',
  'workflow-execute',
  '{"limit":50}'::jsonb
);
`);
    await queryRunner.query(`
select public.schedule_edge_cron(
  'nexus-workflow-cron-tick',
  '* * * * *',
  'workflow-cron-tick',
  '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'WorkflowCrons20260420110000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
