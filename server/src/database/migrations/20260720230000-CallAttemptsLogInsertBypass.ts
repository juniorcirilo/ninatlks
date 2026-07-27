import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `VoiceGuardService.logAttempt()` (modules/voice/voice-guard.service.ts)
 * inserts into `call_attempts_log` via the plain `DataSource` on purpose —
 * the in-code comment claims this is "same as the original's service-role
 * admin client", i.e. a deliberate RLS bypass. That reasoning doesn't hold
 * in this architecture: the plain DataSource pool here is `ninatlks_app`,
 * an ordinary role subject to the same FORCE ROW LEVEL SECURITY as every
 * other connection — it is not a Supabase-style service_role/BYPASSRLS
 * client. `call_attempts_log` (20260420120000-Compliance.ts) has only an
 * admin SELECT policy and **no INSERT policy at all** for any role, so
 * under real RLS this INSERT is rejected outright with a policy-violation
 * error — this is the one gap in this pass that fails loudly (an
 * exception on every dial attempt) rather than silently no-opping,
 * because Postgres denies inserts with no matching policy instead of
 * silently accepting and hiding rows the way SELECT/UPDATE do.
 *
 * Narrow SECURITY DEFINER insert function, consistent with the rest of
 * this pass rather than adding a blanket INSERT policy.
 */
export class CallAttemptsLogInsertBypass20260720230000
  implements MigrationInterface
{
  name = 'CallAttemptsLogInsertBypass20260720230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.call_attempt_log_insert(
        _account_id uuid, _phone_number text, _outcome text,
        _campaign_id uuid DEFAULT NULL, _contact_id uuid DEFAULT NULL, _voice_call_id uuid DEFAULT NULL
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.call_attempts_log (account_id, phone_number, outcome, campaign_id, contact_id, voice_call_id)
        VALUES (_account_id, _phone_number, _outcome, _campaign_id, _contact_id, _voice_call_id);
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.call_attempt_log_insert(uuid, text, text, uuid, uuid, uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.call_attempt_log_insert(uuid, text, text, uuid, uuid, uuid) FROM PUBLIC;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.call_attempt_log_insert(uuid, text, text, uuid, uuid, uuid);`,
    );
  }
}
