import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260425000006_ca78dfef-1638-4148-ae29-b971c56f664e.sql.
export class Migration20260425000006 implements MigrationInterface {
  name = 'Migration20260425000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$
DECLARE
  v_user RECORD;
  v_account_id uuid;
  v_user_name text;
  v_account_name text;
BEGIN
  FOR v_user IN
    SELECT u.id, u.email, u.raw_user_meta_data, u.email_confirmed_at
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    v_user_name := COALESCE(
      v_user.raw_user_meta_data ->> 'name',
      v_user.raw_user_meta_data ->> 'full_name',
      split_part(v_user.email, '@', 1)
    );
    v_account_name := COALESCE(
      v_user.raw_user_meta_data ->> 'workspace_name',
      v_user_name || ' Workspace'
    );

    INSERT INTO public.profiles (id, email, name, display_name, confirmed_at, is_super_admin, super_admin_onboarding_completed)
    VALUES (v_user.id, v_user.email, v_user_name, v_user_name, v_user.email_confirmed_at, true, false);

    INSERT INTO public.accounts (name, support_email)
    VALUES (v_account_name, v_user.email)
    RETURNING id INTO v_account_id;

    INSERT INTO public.account_users (account_id, user_id) VALUES (v_account_id, v_user.id);
    INSERT INTO public.user_roles (account_id, user_id, role) VALUES (v_account_id, v_user.id, 'admin');
    INSERT INTO public.org_onboarding_state (account_id) VALUES (v_account_id) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260425000006 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
