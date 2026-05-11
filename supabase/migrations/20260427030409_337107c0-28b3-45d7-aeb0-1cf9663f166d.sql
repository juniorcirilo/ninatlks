-- =============================================================
-- Single-tenant lock + team management RPCs + onboarding dismissal
-- =============================================================

-- 1) Workspace primário ----------------------------------------
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_primary_idx
  ON public.accounts ((true)) WHERE is_primary = true;

DO $$
DECLARE
  v_count int;
  v_id uuid;
BEGIN
  SELECT count(*) INTO v_count FROM public.accounts;
  IF v_count = 1 THEN
    SELECT id INTO v_id FROM public.accounts LIMIT 1;
    UPDATE public.accounts SET is_primary = true WHERE id = v_id;
  END IF;
END $$;

-- 2) Onboarding dismissed_at -----------------------------------
ALTER TABLE public.org_onboarding_state
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- 3) handle_new_user com lock single-tenant --------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  new_account_id uuid;
  account_name text;
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
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.accounts WHERE is_primary = true)
    INTO v_primary_exists;

  IF v_primary_exists THEN
    DELETE FROM public.profiles WHERE id = new.id;
    RAISE EXCEPTION 'Cadastros desativados. Solicite um convite ao administrador.';
  END IF;

  account_name := coalesce(
    new.raw_user_meta_data ->> 'workspace_name',
    user_name || ' Workspace'
  );

  INSERT INTO public.accounts (name, support_email, is_primary)
    VALUES (account_name, new.email, true)
    RETURNING id INTO new_account_id;

  INSERT INTO public.account_users (account_id, user_id)
    VALUES (new_account_id, new.id);

  INSERT INTO public.user_roles (account_id, user_id, role)
    VALUES (new_account_id, new.id, 'admin');

  INSERT INTO public.org_onboarding_state (account_id) VALUES (new_account_id);

  RETURN new;
END;
$function$;

-- 4) onboarding_dismiss / onboarding_reopen --------------------
CREATE OR REPLACE FUNCTION public.onboarding_dismiss(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.org_onboarding_state
    SET dismissed_at = now()
    WHERE account_id = p_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.onboarding_dismiss(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.onboarding_reopen(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.org_onboarding_state
    SET dismissed_at = NULL
    WHERE account_id = p_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.onboarding_reopen(uuid) TO authenticated;

-- 5) team_change_role ------------------------------------------
CREATE OR REPLACE FUNCTION public.team_change_role(
  p_account_id uuid,
  p_target_user_id uuid,
  p_new_role public.app_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_count int;
  v_target_is_admin boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE account_id = p_account_id
      AND user_id = p_target_user_id
      AND role = 'admin'::app_role
  ) INTO v_target_is_admin;

  IF v_target_is_admin AND p_new_role <> 'admin'::app_role THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_roles
    WHERE account_id = p_account_id AND role = 'admin'::app_role;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Não é possível rebaixar o último admin do workspace.';
    END IF;
  END IF;

  DELETE FROM public.user_roles
    WHERE account_id = p_account_id AND user_id = p_target_user_id;

  INSERT INTO public.user_roles (account_id, user_id, role)
    VALUES (p_account_id, p_target_user_id, p_new_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_change_role(uuid, uuid, public.app_role) TO authenticated;

-- 6) team_remove_member ----------------------------------------
CREATE OR REPLACE FUNCTION public.team_remove_member(
  p_account_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_count int;
  v_target_is_admin boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode remover a si mesmo.';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.user_roles
    WHERE account_id = p_account_id
      AND user_id = p_target_user_id
      AND role = 'admin'::app_role
  ) INTO v_target_is_admin;

  IF v_target_is_admin THEN
    SELECT count(*) INTO v_admin_count
    FROM public.user_roles
    WHERE account_id = p_account_id AND role = 'admin'::app_role;

    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'Não é possível remover o último admin do workspace.';
    END IF;
  END IF;

  DELETE FROM public.user_roles
    WHERE account_id = p_account_id AND user_id = p_target_user_id;
  DELETE FROM public.account_users
    WHERE account_id = p_account_id AND user_id = p_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_remove_member(uuid, uuid) TO authenticated;

-- 7) invite_preview --------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_preview(p_token text)
RETURNS TABLE(account_name text, role text, email_hint text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.name AS account_name,
    i.role::text AS role,
    substr(i.email, 1, 1) || '***@' || split_part(i.email, '@', 2) AS email_hint,
    i.expires_at
  FROM public.invites i
  JOIN public.accounts a ON a.id = i.account_id
  WHERE i.token = p_token
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_preview(text) TO anon, authenticated;

-- 8) team_list_members -----------------------------------------
CREATE OR REPLACE FUNCTION public.team_list_members(p_account_id uuid)
RETURNS TABLE(
  user_id uuid,
  email text,
  name text,
  role text,
  joined_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_account_member(auth.uid(), p_account_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    au.user_id,
    p.email,
    coalesce(p.display_name, p.name, p.email) AS name,
    coalesce(ur.role::text, 'agent') AS role,
    au.created_at AS joined_at
  FROM public.account_users au
  LEFT JOIN public.profiles p ON p.id = au.user_id
  LEFT JOIN public.user_roles ur ON ur.user_id = au.user_id AND ur.account_id = au.account_id
  WHERE au.account_id = p_account_id
  ORDER BY au.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.team_list_members(uuid) TO authenticated;