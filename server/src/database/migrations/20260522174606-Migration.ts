import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260522174606_e9621896-9d42-4387-a7a5-17cbafd1217a.sql.
export class Migration20260522174606 implements MigrationInterface {
  name = 'Migration20260522174606';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- system_settings: lock down writes to super admins
DROP POLICY IF EXISTS "auth insert system_settings" ON public.system_settings;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "auth update system_settings" ON public.system_settings;
`);
    await queryRunner.query(`
CREATE POLICY "super_admin insert system_settings"
  ON public.system_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
`);
    await queryRunner.query(`
CREATE POLICY "super_admin update system_settings"
  ON public.system_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
`);
    await queryRunner.query(`
-- invites: restrict SELECT to admins (token is sensitive)
DROP POLICY IF EXISTS invites_select_member ON public.invites;
`);
    await queryRunner.query(`
CREATE POLICY invites_select_admin
  ON public.invites FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
-- voice-recordings storage: drop duplicate {public}-role policies
DROP POLICY IF EXISTS "Account members read voice-recordings" ON storage.objects;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "Account members delete voice-recordings" ON storage.objects;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "Account members upload voice-recordings" ON storage.objects;
`);
    await queryRunner.query(`
CREATE POLICY voice_recordings_member_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'voice-recordings'
    AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
`);
    await queryRunner.query(`
CREATE POLICY voice_recordings_member_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'voice-recordings'
    AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260522174606 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
