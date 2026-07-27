import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes a real gap found while testing RLS with a non-superuser app role
 * (previously the app DB user was superuser, which silently bypasses RLS
 * regardless of policy — see the FORCE ROW LEVEL SECURITY change made
 * directly against the local dev DB). Once RLS actually applies:
 *
 * - `password_reset_tokens` had no migration at all (entity existed, table
 *   didn't) — added here, RLS-free like `sessions` (looked up by unguessable
 *   token / already-known user id, not by identity).
 * - AuthService and the auth Guards (SessionAuthGuard/AccountMemberGuard/
 *   RolesGuard) all run outside `TenantTxHost` by design (see AuthService's
 *   class doc) — they execute *before* any user/account identity has been
 *   established, so `app.current_user_id`/`app.current_account_id` are never
 *   set on their connection. `profiles`, `account_users` and `user_roles`
 *   all have RLS policies keyed on `auth.uid()`, which is NULL there — every
 *   one of these lookups silently returned zero rows once RLS started being
 *   enforced (login, /auth/me, and *every* account-scoped route via
 *   AccountMemberGuard/RolesGuard, since their own job is to answer the
 *   membership question RLS was blocking). SECURITY DEFINER functions give
 *   these specific, narrow, already-guarded call sites a controlled bypass
 *   without touching RLS for anything else in the app.
 */
export class PreAuthRlsBypass20260720100000 implements MigrationInterface {
  name = 'PreAuthRlsBypass20260720100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
        user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
        token text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL
      );
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_get_profile_by_email(_email text)
      RETURNS SETOF public.profiles
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.profiles WHERE email = _email;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_get_profile_by_id(_id uuid)
      RETURNS SETOF public.profiles
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.profiles WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_set_profile_password(_id uuid, _password_hash text, _password_algo text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.profiles SET password_hash = _password_hash, password_algo = _password_algo WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_get_primary_membership(_user_id uuid)
      RETURNS TABLE(account_id uuid, role text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT au.account_id, ur.role
        FROM public.account_users au
        LEFT JOIN public.user_roles ur ON ur.user_id = au.user_id AND ur.account_id = au.account_id
        WHERE au.user_id = _user_id
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.guard_check_account_membership(_user_id uuid, _account_id uuid)
      RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.account_users
          WHERE user_id = _user_id AND account_id = _account_id
        );
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.guard_get_user_roles(_user_id uuid, _account_id uuid)
      RETURNS TABLE(role text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT role FROM public.user_roles
        WHERE user_id = _user_id AND account_id = _account_id;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON public.password_reset_tokens TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.auth_get_profile_by_email(text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.auth_get_profile_by_id(uuid) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.auth_set_profile_password(uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.auth_get_primary_membership(uuid) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.guard_check_account_membership(uuid, uuid) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.guard_get_user_roles(uuid, uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.auth_get_profile_by_email(text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.auth_get_profile_by_id(uuid) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.auth_set_profile_password(uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.auth_get_primary_membership(uuid) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.guard_check_account_membership(uuid, uuid) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.guard_get_user_roles(uuid, uuid) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.guard_get_user_roles(uuid, uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.guard_check_account_membership(uuid, uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_get_primary_membership(uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_set_profile_password(uuid, text, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_get_profile_by_id(uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_get_profile_by_email(text);`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS public.password_reset_tokens;`,
    );
  }
}
