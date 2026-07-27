import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same gap as PreAuthRlsBypass20260720100000, found next: RealtimeGateway's
 * WebSocket handshake (handleConnection) queries `account_users` to decide
 * which `account:{id}` rooms to join — also runs outside TenantTxHost (socket
 * handshakes don't go through the HTTP interceptor pipeline), so under real
 * RLS it always saw zero memberships and every socket silently joined no
 * account room at all.
 */
export class RealtimeMembershipBypass20260720110000
  implements MigrationInterface
{
  name = 'RealtimeMembershipBypass20260720110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.auth_get_account_ids_for_user(_user_id uuid)
      RETURNS TABLE(account_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT account_id FROM public.account_users WHERE user_id = _user_id;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.auth_get_account_ids_for_user(uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.auth_get_account_ids_for_user(uuid) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.auth_get_account_ids_for_user(uuid);`,
    );
  }
}
