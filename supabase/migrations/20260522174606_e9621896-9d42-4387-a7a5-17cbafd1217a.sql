
-- system_settings: lock down writes to super admins
DROP POLICY IF EXISTS "auth insert system_settings" ON public.system_settings;
DROP POLICY IF EXISTS "auth update system_settings" ON public.system_settings;

CREATE POLICY "super_admin insert system_settings"
  ON public.system_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "super_admin update system_settings"
  ON public.system_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- invites: restrict SELECT to admins (token is sensitive)
DROP POLICY IF EXISTS invites_select_member ON public.invites;

CREATE POLICY invites_select_admin
  ON public.invites FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));

-- voice-recordings storage: drop duplicate {public}-role policies
DROP POLICY IF EXISTS "Account members read voice-recordings" ON storage.objects;
DROP POLICY IF EXISTS "Account members delete voice-recordings" ON storage.objects;
DROP POLICY IF EXISTS "Account members upload voice-recordings" ON storage.objects;

CREATE POLICY voice_recordings_member_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'voice-recordings'
    AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY voice_recordings_member_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'voice-recordings'
    AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
