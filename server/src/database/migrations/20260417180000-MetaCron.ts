import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260417180000_meta_cron.sql. Lines requiring Supabase-platform-only extensions were
// commented out and replaced by scripts/db/00-compat-shims.sql equivalents:
//   create extension if not exists pg_cron with schema extensions;
//   create extension if not exists pg_net  with schema extensions;
export class MetaCron20260417180000 implements MigrationInterface {
  name = 'MetaCron20260417180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Cron jobs for Meta integration maintenance
-- ============================================================
-- Schedules two recurring edge function invocations via pg_cron + pg_net:
--   1. dispatch-retry every 5 minutes → replays failed outbound messages
--   2. templates-sync  every 15 minutes → reconciles template approval state
--
-- Requires the pg_cron and pg_net extensions (already installed on Supabase).
-- The jobs read the project URL + service role key from GUCs that the
-- Lovable/Supabase runtime exposes (\`app.supabase_url\`, \`app.service_role_key\`).
-- If your setup uses different GUC names, edit the SQL below.
-- [stripped by generate-typeorm-migrations.mjs, see scripts/db/00-compat-shims.sql]: create extension if not exists pg_cron with schema extensions;
-- [stripped by generate-typeorm-migrations.mjs, see scripts/db/00-compat-shims.sql]: create extension if not exists pg_net  with schema extensions;

-- Helper that schedules an edge-function ping with the right headers.
-- We wrap it so each job row stays short and auditable.
create or replace function public.schedule_edge_cron(
  p_name text,
  p_schedule text,
  p_function text,
  p_body jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing bigint;
begin
  -- Unschedule any previous job with the same name so the migration is idempotent.
  select jobid into v_existing from cron.job where jobname = p_name;
  if v_existing is not null then
    perform cron.unschedule(v_existing);
  end if;

  perform cron.schedule(
    p_name,
    p_schedule,
    format(
      $cmd$
      select net.http_post(
        url := current_setting('app.supabase_url', true) || '/functions/v1/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
        ),
        body := %L::jsonb
      );
      $cmd$,
      p_function,
      p_body::text
    )
  );
end;
$$;
`);
    await queryRunner.query(`
-- 1. Replay failed dispatches every 5 min
select public.schedule_edge_cron(
  'nexus-dispatch-retry',
  '*/5 * * * *',
  'dispatch-retry',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- 2. Keep WhatsApp templates approval status in sync every 15 min.
--    Sending an empty body triggers the service-role "sync every enabled
--    whatsapp channel" branch inside templates-sync.
select public.schedule_edge_cron(
  'nexus-templates-sync',
  '*/15 * * * *',
  'templates-sync',
  '{}'::jsonb
);
`);
    await queryRunner.query(`
-- Optional: surface the job list so ops can audit with a single query.
comment on function public.schedule_edge_cron(text, text, text, jsonb) is
  'Idempotent helper: unschedule-by-name + cron.schedule a net.http_post to a Supabase edge function. Use in migrations.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'MetaCron20260417180000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
