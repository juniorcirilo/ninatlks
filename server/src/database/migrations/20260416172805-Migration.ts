import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416172805_346c28db-9266-41fd-8e7f-bc81f27766eb.sql.
export class Migration20260416172805 implements MigrationInterface {
  name = 'Migration20260416172805';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Onboarding state per account
CREATE TABLE public.org_onboarding_state (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  current_step varchar(20) NOT NULL DEFAULT 'welcome'
    CHECK (current_step IN ('welcome','org','inbox','keys','invite','persona','done')),
  completed_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
`);
    await queryRunner.query(`
ALTER TABLE public.org_onboarding_state ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "onboarding_select_admin" ON public.org_onboarding_state
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "onboarding_insert_admin" ON public.org_onboarding_state
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "onboarding_update_admin" ON public.org_onboarding_state
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- Channel types enum
CREATE TYPE public.channel_type AS ENUM ('web_widget','email','whatsapp','instagram','voice');
`);
    await queryRunner.query(`
-- Channels table
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  channel_type public.channel_type NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "channels_select_member" ON public.channels
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "channels_insert_admin" ON public.channels
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "channels_update_admin" ON public.channels
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "channels_delete_admin" ON public.channels
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE TRIGGER set_channels_updated_at
  BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- Inboxes table
CREATE TABLE public.inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  name text NOT NULL,
  greeting_message text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
ALTER TABLE public.inboxes ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "inboxes_select_member" ON public.inboxes
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "inboxes_insert_admin" ON public.inboxes
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "inboxes_update_admin" ON public.inboxes
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "inboxes_delete_admin" ON public.inboxes
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE TRIGGER set_inboxes_updated_at
  BEFORE UPDATE ON public.inboxes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- Persona status enum
CREATE TYPE public.persona_status AS ENUM ('draft','active','archived');
`);
    await queryRunner.query(`
-- Agent personas table
CREATE TABLE public.agent_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source_user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.persona_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
ALTER TABLE public.agent_personas ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "personas_select_member" ON public.agent_personas
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "personas_insert_admin" ON public.agent_personas
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "personas_update_admin" ON public.agent_personas
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "personas_delete_admin" ON public.agent_personas
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE TRIGGER set_personas_updated_at
  BEFORE UPDATE ON public.agent_personas
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- Auto-create onboarding state for new accounts via trigger update
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  new_account_id uuid;
  account_name text;
  user_name text;
begin
  user_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  account_name := coalesce(
    new.raw_user_meta_data ->> 'workspace_name',
    user_name || ' Workspace'
  );

  -- 1. Profile
  insert into public.profiles (id, email, name, display_name, confirmed_at)
  values (new.id, new.email, user_name, user_name, new.email_confirmed_at);

  -- 2. Account
  insert into public.accounts (name, support_email)
  values (account_name, new.email)
  returning id into new_account_id;

  -- 3. Membership
  insert into public.account_users (account_id, user_id)
  values (new_account_id, new.id);

  -- 4. Role admin
  insert into public.user_roles (account_id, user_id, role)
  values (new_account_id, new.id, 'admin');

  -- 5. Onboarding state
  insert into public.org_onboarding_state (account_id)
  values (new_account_id);

  return new;
end;
$function$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416172805 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
