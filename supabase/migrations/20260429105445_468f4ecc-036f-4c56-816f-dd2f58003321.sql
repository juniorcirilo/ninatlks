-- 1. Singleton físico em accounts
CREATE UNIQUE INDEX IF NOT EXISTS accounts_singleton_idx
  ON public.accounts ((true))
  WHERE is_primary = true;

CREATE OR REPLACE FUNCTION public.enforce_single_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.accounts) >= 1 THEN
    RAISE EXCEPTION 'Plataforma single-tenant: já existe um workspace.'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.is_primary := true;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_single_tenant ON public.accounts;
CREATE TRIGGER accounts_single_tenant
  BEFORE INSERT ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_account();

-- 2. Limpa usuários órfãos de teste (sem account_users)
DELETE FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.account_users au WHERE au.user_id = u.id
);

-- 3. Atualiza handle_new_user: nome do workspace fixo, mensagem clara
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_account_id uuid;
  user_name text;
  v_invite_token text;
  v_invite RECORD;
  v_primary_exists boolean;
BEGIN
  user_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  INSERT INTO public.profiles (id, email, name, display_name, confirmed_at)
  VALUES (new.id, new.email, user_name, user_name, new.email_confirmed_at);

  -- Caminho 1: signup com token de convite válido
  v_invite_token := new.raw_user_meta_data ->> 'invite_token';
  IF v_invite_token IS NOT NULL AND length(v_invite_token) > 0 THEN
    SELECT id, account_id, role INTO v_invite FROM public.invites
      WHERE token = v_invite_token
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now();
    IF FOUND THEN
      INSERT INTO public.account_users (account_id, user_id)
        VALUES (v_invite.account_id, new.id);
      INSERT INTO public.user_roles (account_id, user_id, role)
        VALUES (v_invite.account_id, new.id, v_invite.role)
        ON CONFLICT DO NOTHING;
      UPDATE public.invites
        SET accepted_at = now(), accepted_by_user_id = new.id
        WHERE id = v_invite.id;
      RETURN new;
    ELSE
      DELETE FROM public.profiles WHERE id = new.id;
      RAISE EXCEPTION 'Convite inválido ou expirado. Solicite um novo link ao administrador.';
    END IF;
  END IF;

  -- Caminho 2: já existe admin → bloqueia signup direto
  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE is_primary = true)
    INTO v_primary_exists;

  IF v_primary_exists THEN
    DELETE FROM public.profiles WHERE id = new.id;
    RAISE EXCEPTION 'Cadastro fechado. Esta plataforma só aceita novos usuários por convite do administrador.';
  END IF;

  -- Caminho 3: 1º signup → vira admin do workspace único
  INSERT INTO public.accounts (name, support_email, is_primary)
    VALUES ('Nina Talks', new.email, true)
    RETURNING id INTO new_account_id;

  INSERT INTO public.account_users (account_id, user_id)
    VALUES (new_account_id, new.id);

  INSERT INTO public.user_roles (account_id, user_id, role)
    VALUES (new_account_id, new.id, 'admin');

  INSERT INTO public.org_onboarding_state (account_id) VALUES (new_account_id);

  RETURN new;
END;
$$;

-- 4. RPC pública para a tela de auth saber se o primeiro admin já existe
CREATE OR REPLACE FUNCTION public.signup_open()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.accounts WHERE is_primary = true);
$$;

GRANT EXECUTE ON FUNCTION public.signup_open() TO anon, authenticated;