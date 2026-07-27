import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `resolveElevenLabsApiKey`/`resolveTwilioCreds` (modules/voice/
 * elevenlabs-creds.util.ts, modules/twilio/twilio-creds.util.ts) and the
 * duplicate `resolveElevenLabsApiKey` in jobs/processors/
 * el-outbound-cron.util.ts all do the same raw join —
 * `account_secrets JOIN vault.decrypted_secrets` — via the plain
 * DataSource, no session context. `account_secrets` is RLS-enabled with
 * only an admin SELECT policy (`has_role(auth.uid(), account_id,
 * 'admin')`); with no session vars set that always evaluates false, so
 * every one of these callers gets zero rows and silently falls back to the
 * `process.env.*` default (or, for Twilio, throws "not configured") even
 * when the account has real per-tenant credentials saved.
 *
 * There's an existing `public.get_account_secrets_bulk(account_id,
 * provider)` SECURITY DEFINER RPC (20260424164850-Migration.ts) that looks
 * like a ready-made fix but isn't usable here: it guards on
 * `current_setting('request.jwt.claim.role') = 'service_role'`, a
 * Supabase-PostgREST JWT claim this app's plain TypeORM connection never
 * sets — calling it as-is always raises "forbidden: service_role
 * required". This is a fresh, narrower function for the same underlying
 * join, without that guard (trust boundary: internal service-to-service
 * use only from voice/twilio credential resolvers, never exposed on a
 * public route — same rationale already documented in
 * elevenlabs-creds.util.ts).
 */
export class AccountSecretsResolveBypass20260720190000
  implements MigrationInterface
{
  name = 'AccountSecretsResolveBypass20260720190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.account_secret_resolve_bundle(_account_id uuid, _provider text)
      RETURNS TABLE(key_name text, decrypted_secret text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT s.key_name, vs.decrypted_secret
        FROM public.account_secrets s
        JOIN vault.decrypted_secrets vs ON vs.id = s.vault_secret_id
        WHERE s.account_id = _account_id AND s.provider = _provider;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.account_secret_resolve_bundle(uuid, text) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `REVOKE EXECUTE ON FUNCTION public.account_secret_resolve_bundle(uuid, text) FROM PUBLIC;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.account_secret_resolve_bundle(uuid, text);`,
    );
  }
}
