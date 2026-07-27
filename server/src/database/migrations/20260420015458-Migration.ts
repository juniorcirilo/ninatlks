import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420015458_b2b5c201-7515-4239-b8ee-ec5994ed12b4.sql.
export class Migration20260420015458 implements MigrationInterface {
  name = 'Migration20260420015458';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Sprint 2: Função para /platform-health visualizar status dos crons sem dar
-- acesso direto a cron.job (que exige superuser).

DROP FUNCTION IF EXISTS public.nexus_cron_status();
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.nexus_cron_status()
RETURNS TABLE (
  jobname text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
BEGIN
  -- Only admins (in any account) may inspect cron status
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    d.start_time AS last_run_at,
    d.status::text AS last_run_status,
    LEFT(COALESCE(d.return_message, ''), 500) AS last_run_message
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, status, return_message
    FROM cron.job_run_details
    WHERE jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON TRUE
  WHERE j.jobname LIKE 'nexus-%'
  ORDER BY j.jobname;
END;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.nexus_cron_status() TO authenticated;
`);
    await queryRunner.query(`
-- Convenience view (re-uses the security-definer function so RLS is enforced)
DROP VIEW IF EXISTS public.nexus_cron_jobs;
`);
    await queryRunner.query(`
CREATE OR REPLACE VIEW public.nexus_cron_jobs AS
SELECT * FROM public.nexus_cron_status();
`);
    await queryRunner.query(`
GRANT SELECT ON public.nexus_cron_jobs TO authenticated;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420015458 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
