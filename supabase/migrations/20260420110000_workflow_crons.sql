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

select public.schedule_edge_cron(
  'nexus-workflow-cron-tick',
  '* * * * *',
  'workflow-cron-tick',
  '{}'::jsonb
);
