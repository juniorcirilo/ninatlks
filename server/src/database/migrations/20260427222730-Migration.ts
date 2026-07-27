import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427222730_79a4ce44-0a5e-423e-aeda-c7fabe8151f7.sql.
export class Migration20260427222730 implements MigrationInterface {
  name = 'Migration20260427222730';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Idempotent: create invites table + RPC missing from remix
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'agent'::public.app_role,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64'),
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_invites_account ON public.invites(account_id, accepted_at);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_invites_email_pending ON public.invites(lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
`);
    await queryRunner.query(`
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "invites_select_member" ON public.invites;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "invites_insert_admin" ON public.invites;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "invites_update_admin" ON public.invites;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "invites_delete_admin" ON public.invites;
`);
    await queryRunner.query(`
CREATE POLICY "invites_select_member" ON public.invites
  FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "invites_insert_admin" ON public.invites
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
CREATE POLICY "invites_update_admin" ON public.invites
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
CREATE POLICY "invites_delete_admin" ON public.invites
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.invites_accept(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.invites;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'must be authenticated';
  END IF;

  SELECT * INTO v_invite FROM public.invites
    WHERE token = p_token
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite not found or expired';
  END IF;

  IF EXISTS (SELECT 1 FROM public.account_users
             WHERE account_id = v_invite.account_id AND user_id = v_user_id) THEN
    UPDATE public.invites SET accepted_at = now(), accepted_by_user_id = v_user_id
      WHERE id = v_invite.id;
    RETURN v_invite.account_id;
  END IF;

  INSERT INTO public.account_users (account_id, user_id)
    VALUES (v_invite.account_id, v_user_id);
  INSERT INTO public.user_roles (account_id, user_id, role)
    VALUES (v_invite.account_id, v_user_id, v_invite.role)
    ON CONFLICT DO NOTHING;

  UPDATE public.invites SET accepted_at = now(), accepted_by_user_id = v_user_id
    WHERE id = v_invite.id;

  RETURN v_invite.account_id;
END;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.invites_accept(text) TO authenticated;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260427222730 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
