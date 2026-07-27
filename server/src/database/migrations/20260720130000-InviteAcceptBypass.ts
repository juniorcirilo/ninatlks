import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same family of bug as PreAuthRlsBypass20260720100000, found by grepping
 * for the exact anti-pattern TenantTxHost's own doc comment warns about
 * (`@InjectRepository` outside common/database — never actually enforced in
 * CI). `invites` SELECT policy is `has_role(auth.uid(), account_id,
 * 'admin')` — fine for an admin listing invites they sent, but
 * AuthService.acceptInvite() looks up an invite *by token* before the
 * person accepting it is a member of the account at all, let alone an
 * admin. Same pre-auth exception as profiles/password_reset_tokens.
 */
export class InviteAcceptBypass20260720130000 implements MigrationInterface {
  name = 'InviteAcceptBypass20260720130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_get_invite_by_token(_token text)
      RETURNS SETOF public.invites
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.invites WHERE token = _token;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.auth_get_invite_by_token(text) TO ninatlks_app;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.auth_get_invite_by_token(text) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_get_invite_by_token(text);`,
    );
  }
}
