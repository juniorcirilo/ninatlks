import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The real root cause behind the two RLS bypass migrations before this one:
 * every ported policy (24+ files, all of them) is scoped `TO authenticated`
 * — a leftover Supabase/PostgREST role from the dump. The app's own DB role
 * (`ninatlks_app` in this environment) was never granted membership in it,
 * so *no* policy on *any* table ever applied to the app's connection —
 * with RLS enabled+forced and zero applicable policies, Postgres defaults
 * to deny for every row and every command. The earlier "RLS isolation"
 * check that appeared to pass was actually just this blanket denial, not
 * real membership-based enforcement (confirmed by a legitimate member's
 * INSERT into `contacts` also failing). Granting the app role membership in
 * `authenticated` is the actual fix — matches how Supabase's own PostgREST
 * layer authenticates (role membership, not a literal role switch).
 *
 * The role name is deployment-specific (`ninatlks_app` here), so this is
 * conditional like the earlier GRANTs. If a deployment's app role is named
 * differently, whoever renames it needs to also re-run an equivalent GRANT.
 */
export class AppRoleAuthenticatedMembership20260720120000
  implements MigrationInterface
{
  name = 'AppRoleAuthenticatedMembership20260720120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          GRANT authenticated TO ninatlks_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app')
           AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE authenticated FROM ninatlks_app;
        END IF;
      END $$;
    `);
  }
}
