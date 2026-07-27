import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419110000_sprint2_crons.sql.
export class Sprint2Crons20260419110000 implements MigrationInterface {
  name = 'Sprint2Crons20260419110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Sprint 2 — Periodic jobs that keep Nexus running without babysitting
-- ============================================================
-- Builds on the public.schedule_edge_cron() helper created in
-- 20260417180000_meta_cron.sql. Idempotent: unschedules any existing job
-- with the same name before re-scheduling.

-- 1. Memory graph stays fresh — extract memories from active conversations
--    every minute (cursor-based, skips already-processed messages).
select public.schedule_edge_cron(
  'nexus-memory-extract-tick',
  '* * * * *',
  'memory-extract-tick',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 2. Signals detection — regex-based scan on open conversations, every 30 min.
select public.schedule_edge_cron(
  'nexus-signals-detect-tick',
  '*/30 * * * *',
  'signals-detect-tick',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 3. Snooze wakeup — flip snoozed conversations back to open when expired.
select public.schedule_edge_cron(
  'nexus-snooze-wakeup-tick',
  '*/2 * * * *',
  'snooze-wakeup-tick',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 4. Media + telemetry cleanup — daily at 03:10 (low traffic window BR).
select public.schedule_edge_cron(
  'nexus-media-cleanup',
  '10 3 * * *',
  'media-cleanup',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 5. Rate-limit alerting — every 10 min, notify admins when Meta API usage > 80%.
select public.schedule_edge_cron(
  'nexus-rate-limit-alert',
  '*/10 * * * *',
  'rate-limit-alert',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 6. Improvement loop — try to auto-promote better prompts every 6 hours.
select public.schedule_edge_cron(
  'nexus-improvement-tick',
  '0 */6 * * *',
  'improvement-tick',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- ============================================================
-- Surface all nexus-prefixed cron jobs in a single admin-visible view so
-- operators can check "are the jobs actually running?" without needing
-- cron extension access directly.
-- ============================================================
create or replace view public.nexus_cron_jobs as
select
  j.jobid,
  j.jobname,
  j.schedule,
  j.active,
  (
    select start_time
      from cron.job_run_details d
     where d.jobid = j.jobid
     order by start_time desc
     limit 1
  ) as last_run_at,
  (
    select status
      from cron.job_run_details d
     where d.jobid = j.jobid
     order by start_time desc
     limit 1
  ) as last_run_status,
  (
    select return_message
      from cron.job_run_details d
     where d.jobid = j.jobid
     order by start_time desc
     limit 1
  ) as last_run_message
from cron.job j
where j.jobname like 'nexus-%'
order by j.jobname;
`);
    await queryRunner.query(`
comment on view public.nexus_cron_jobs is
  'Single row per Nexus cron job with last-run metadata. Read-only; accessed via platform-health UI.';
`);
    await queryRunner.query(`
-- Grant the view to authenticated admins via a security definer function,
-- since cron.job table itself isn't RLS-aware.
create or replace function public.nexus_cron_status()
returns setof public.nexus_cron_jobs
language sql
stable
security definer
set search_path = public, cron
as $$
  select * from public.nexus_cron_jobs;
$$;
`);
    await queryRunner.query(`
revoke all on function public.nexus_cron_status() from public;
`);
    await queryRunner.query(`
grant execute on function public.nexus_cron_status() to authenticated;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Sprint2Crons20260419110000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
