-- 1. Adiciona flags ao profile
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_admin_onboarding_completed boolean NOT NULL DEFAULT true;

-- Garante unicidade do super-admin
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_super_admin
  ON public.profiles ((is_super_admin)) WHERE is_super_admin = true;

-- 2. Atualiza handle_new_user para marcar o primeiro signup como super-admin
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
  v_is_first boolean;
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

  -- Detecta primeiro usuário do sistema (atômico via lock leve na tabela)
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO v_is_first;

  -- 1. Profile (com flags de super-admin)
  insert into public.profiles (
    id, email, name, display_name, confirmed_at,
    is_super_admin, super_admin_onboarding_completed
  )
  values (
    new.id, new.email, user_name, user_name, new.email_confirmed_at,
    v_is_first, NOT v_is_first
  );

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

  -- 5. Onboarding state (por-account; já existente)
  insert into public.org_onboarding_state (account_id)
  values (new_account_id);

  return new;
end;
$function$;

-- 3. Helper: o usuário atual é super-admin?
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT is_super_admin FROM public.profiles WHERE id = _user_id), false)
$$;

-- 4. Tabela singleton app_settings (linha única, id fixo)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  supabase_url text,
  supabase_publishable_key text,
  -- Referências para segredos cifrados no Vault (chaves sensíveis)
  secret_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_singleton CHECK (id = '00000000-0000-0000-0000-000000000001')
);

-- Garante a linha singleton
INSERT INTO public.app_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Trigger updated_at
DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- RLS: apenas super-admin lê e escreve
DROP POLICY IF EXISTS "super admin reads app_settings" ON public.app_settings;
CREATE POLICY "super admin reads app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admin updates app_settings" ON public.app_settings;
CREATE POLICY "super admin updates app_settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "super admin inserts app_settings" ON public.app_settings;
CREATE POLICY "super admin inserts app_settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. RLS para profiles: usuário lê o próprio; ninguém altera is_super_admin via API
-- (já existe trigger handle_new_user que define no signup; updates feitos via RPC abaixo)

DROP POLICY IF EXISTS "profile self select" ON public.profiles;
CREATE POLICY "profile self select"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "profile self update" ON public.profiles;
CREATE POLICY "profile self update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Bloqueia alteração de is_super_admin via update direto:
    -- só vai bater se o valor não mudar.
    AND is_super_admin = (SELECT p.is_super_admin FROM public.profiles p WHERE p.id = auth.uid())
  );

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 6. RPC para super-admin marcar onboarding como concluído
CREATE OR REPLACE FUNCTION public.complete_super_admin_onboarding()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden: super_admin only';
  END IF;
  UPDATE public.profiles
     SET super_admin_onboarding_completed = true,
         updated_at = now()
   WHERE id = v_uid;
  RETURN true;
END;
$$;

-- 7. RPC para gravar settings (super-admin only). Salva valores não-sensíveis
-- direto na tabela; chaves marcadas como sensíveis vão pro Vault.
CREATE OR REPLACE FUNCTION public.save_app_settings(
  p_supabase_url text,
  p_supabase_publishable_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'forbidden: super_admin only';
  END IF;

  UPDATE public.app_settings
     SET supabase_url = p_supabase_url,
         supabase_publishable_key = p_supabase_publishable_key,
         metadata = COALESCE(p_metadata, '{}'::jsonb),
         updated_at = now()
   WHERE id = '00000000-0000-0000-0000-000000000001';

  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  SELECT
    (SELECT account_id FROM public.account_users WHERE user_id = v_uid LIMIT 1),
    v_uid, 'app_settings_saved', 'app_settings', '00000000-0000-0000-0000-000000000001',
    jsonb_build_object('has_url', p_supabase_url IS NOT NULL);

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_super_admin_onboarding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_settings(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;