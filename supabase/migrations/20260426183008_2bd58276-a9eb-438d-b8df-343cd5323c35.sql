-- Corrige verificação de role nas RPCs do Vault.
-- Antes: usava current_setting('request.jwt.claim.role', true), que só é
-- preenchido pelo PostgREST quando há JWT com claim 'role'. Edge Functions
-- chamando admin.rpc() com a service_role key não populam essa GUC, então
-- a função sempre lançava 'forbidden' e o wrapper caía silenciosamente
-- para fallback de env var, retornando uma key inválida.
--
-- Agora: usa current_user, que o PostgREST configura via SET ROLE de
-- forma confiável tanto para JWT quanto para apikey de service_role.

CREATE OR REPLACE FUNCTION public.get_account_secret(
  p_account_id UUID,
  p_provider TEXT,
  p_key_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
  v_value TEXT;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets (got %)', current_user;
  END IF;

  SELECT vault_secret_id INTO v_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id AND provider = p_provider AND key_name = p_key_name;

  IF v_vault_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_value
  FROM vault.decrypted_secrets
  WHERE id = v_vault_id;

  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_account_secrets_bulk(
  p_account_id UUID,
  p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  r RECORD;
  v_value TEXT;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets (got %)', current_user;
  END IF;

  FOR r IN
    SELECT key_name, vault_secret_id
    FROM public.account_secrets
    WHERE account_id = p_account_id AND provider = p_provider
  LOOP
    SELECT decrypted_secret INTO v_value
    FROM vault.decrypted_secrets WHERE id = r.vault_secret_id;
    v_result := v_result || jsonb_build_object(r.key_name, v_value);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) TO service_role;