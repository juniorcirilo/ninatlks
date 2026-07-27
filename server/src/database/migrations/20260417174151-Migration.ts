import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260417174151_964102ea-0ff2-4ace-a9f6-1d15ba7a61bf.sql.
export class Migration20260417174151 implements MigrationInterface {
  name = 'Migration20260417174151';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Schedule dispatch-retry every 5 minutes using vault-stored service role key
do $$
declare
  v_service_key text;
begin
  -- Try to read service role from vault (requires it to be added there).
  -- If not available, the cron job is still scheduled but will return 403 until secret is set.
  begin
    select decrypted_secret into v_service_key
    from vault.decrypted_secrets
    where name = 'service_role_key'
    limit 1;
  exception when others then
    v_service_key := null;
  end;

  -- Unschedule previous version if any
  perform cron.unschedule('dispatch-retry-every-5min')
  where exists (select 1 from cron.job where jobname = 'dispatch-retry-every-5min');

  -- Schedule new job
  perform cron.schedule(
    'dispatch-retry-every-5min',
    '*/5 * * * *',
    format($cron$
      select net.http_post(
        url := 'https://rjcgdesoiujrvtsjrgdy.supabase.co/functions/v1/dispatch-retry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{}'::jsonb
      )
    $cron$, coalesce(v_service_key, 'MISSING_SERVICE_ROLE_IN_VAULT'))
  );
end $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260417174151 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
