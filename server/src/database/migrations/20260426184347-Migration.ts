import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426184347_ccc0e393-0125-4c6b-9cf1-11b77b237c66.sql.
export class Migration20260426184347 implements MigrationInterface {
  name = 'Migration20260426184347';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Fix the authorization check in get_account_secret / get_account_secrets_bulk.
--
-- Background:
--   These RPCs are SECURITY DEFINER. Inside that context \`current_user\`
--   is the function OWNER (postgres), never the caller's role. So the
--   check \`current_user <> 'service_role'\` always raised, even when
--   edge functions invoked the RPC with the service role key.
--
-- New strategy: trust PostgREST's request claim. When PostgREST receives
-- a service_role JWT/apikey it sets request.jwt.claim.role = 'service_role'.
-- We verify that claim. We also accept calls where session_user is
-- service_role (covers direct DB connections). Direct postgres-as-superuser
-- calls (SQL Editor / migrations) are also allowed because they need to be
-- able to invoke this for diagnostics.

CREATE OR REPLACE FUNCTION public.get_account_secret(
  p_account_id UUID,
  p_provider TEXT,
  p_key_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
  v_value TEXT;
  v_jwt_role TEXT;
  v_session_user TEXT := session_user;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);

  IF NOT (
    v_jwt_role = 'service_role'
    OR v_session_user IN ('service_role', 'postgres', 'supabase_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets (jwt_role=%, session_user=%)',
      COALESCE(v_jwt_role, 'null'), v_session_user;
  END IF;

  SELECT vault_secret_id INTO v_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id AND provider = p_provider AND key_name = p_key_name;

  IF v_vault_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_value
  FROM vault.decrypted_secrets
  WHERE id = v_vault_id;

  RETURN v_value;
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.get_account_secrets_bulk(
  p_account_id UUID,
  p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  r RECORD;
  v_value TEXT;
  v_jwt_role TEXT;
  v_session_user TEXT := session_user;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);

  IF NOT (
    v_jwt_role = 'service_role'
    OR v_session_user IN ('service_role', 'postgres', 'supabase_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets (jwt_role=%, session_user=%)',
      COALESCE(v_jwt_role, 'null'), v_session_user;
  END IF;

  FOR r IN
    SELECT key_name, vault_secret_id
    FROM public.account_secrets
    WHERE account_id = p_account_id AND provider = p_provider
  LOOP
    SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets WHERE id = r.vault_secret_id;
    v_result := v_result || jsonb_build_object(r.key_name, v_value);
  END LOOP;

  RETURN v_result;
END;
$$;
`);
    await queryRunner.query(`
-- Re-assert grants (idempotent)
REVOKE ALL ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
`);
    await queryRunner.query(`
REVOKE ALL ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) FROM PUBLIC, anon, authenticated;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) TO service_role;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) TO service_role;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426184347 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
