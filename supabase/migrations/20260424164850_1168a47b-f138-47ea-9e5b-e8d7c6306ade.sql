-- ============================================================================
-- Phase 1: Per-account encrypted secrets via Supabase Vault
-- ============================================================================

-- Ensure vault extension is available (managed by Supabase, but safe to assert)
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- ----------------------------------------------------------------------------
-- account_secrets: maps (account_id, provider, key_name) -> vault.secrets.id
-- The actual secret value lives encrypted inside vault.secrets.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_secrets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,           -- 'twilio' | 'elevenlabs' | 'deepgram' | 'evolution' | 'zernio' | 'meta' | ...
  key_name TEXT NOT NULL,           -- e.g. 'api_key', 'auth_token', 'account_sid', 'url', 'access_token'
  vault_secret_id UUID NOT NULL,    -- references vault.secrets(id) (cross-schema, no FK)
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, key_name)
);

CREATE INDEX IF NOT EXISTS idx_account_secrets_account ON public.account_secrets(account_id);
CREATE INDEX IF NOT EXISTS idx_account_secrets_provider ON public.account_secrets(account_id, provider);

ALTER TABLE public.account_secrets ENABLE ROW LEVEL SECURITY;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_account_secrets_updated_at ON public.account_secrets;
CREATE TRIGGER trg_account_secrets_updated_at
  BEFORE UPDATE ON public.account_secrets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: Only admins of the account may see metadata about their secrets.
--      The actual secret values are NEVER exposed via SELECT — they live in
--      vault.secrets and are only readable by service_role through the RPCs
--      below. service_role bypasses RLS, so no policy is required for it.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view their account secrets metadata" ON public.account_secrets;
CREATE POLICY "Admins can view their account secrets metadata"
  ON public.account_secrets FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));

-- No INSERT/UPDATE/DELETE policies for authenticated users — all writes go
-- through the SECURITY DEFINER RPCs below to ensure vault.secrets stays in sync.

-- ----------------------------------------------------------------------------
-- RPC: set_account_secret(account_id, provider, key_name, value, metadata)
-- Creates or updates a secret. Caller must be admin of the account.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_account_secret(
  p_account_id UUID,
  p_provider TEXT,
  p_key_name TEXT,
  p_value TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_existing_vault_id UUID;
  v_new_vault_id UUID;
  v_secret_name TEXT;
BEGIN
  -- Authorization: only admins of the account
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for account %', p_account_id;
  END IF;

  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    RAISE EXCEPTION 'value cannot be empty';
  END IF;

  -- Check if a record already exists
  SELECT vault_secret_id INTO v_existing_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id
    AND provider = p_provider
    AND key_name = p_key_name;

  v_secret_name := format('account_%s_%s_%s', p_account_id, p_provider, p_key_name);

  IF v_existing_vault_id IS NOT NULL THEN
    -- Update existing vault secret in place
    PERFORM vault.update_secret(v_existing_vault_id, p_value, v_secret_name, NULL);

    UPDATE public.account_secrets
       SET metadata = COALESCE(p_metadata, '{}'::jsonb),
           updated_at = now()
     WHERE account_id = p_account_id
       AND provider = p_provider
       AND key_name = p_key_name;

    RETURN v_existing_vault_id;
  ELSE
    -- Create new vault secret
    v_new_vault_id := vault.create_secret(p_value, v_secret_name, NULL);

    INSERT INTO public.account_secrets (
      account_id, provider, key_name, vault_secret_id, metadata, created_by
    ) VALUES (
      p_account_id, p_provider, p_key_name, v_new_vault_id,
      COALESCE(p_metadata, '{}'::jsonb), auth.uid()
    );

    -- Audit log
    INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
    VALUES (p_account_id, auth.uid(), 'secret_created', 'account_secret',
            format('%s/%s', p_provider, p_key_name),
            jsonb_build_object('provider', p_provider, 'key_name', p_key_name));

    RETURN v_new_vault_id;
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: delete_account_secret(account_id, provider, key_name)
-- Removes the secret from both the mapping table and vault.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_account_secret(
  p_account_id UUID,
  p_provider TEXT,
  p_key_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_vault_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for account %', p_account_id;
  END IF;

  SELECT vault_secret_id INTO v_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id AND provider = p_provider AND key_name = p_key_name;

  IF v_vault_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.account_secrets
   WHERE account_id = p_account_id AND provider = p_provider AND key_name = p_key_name;

  DELETE FROM vault.secrets WHERE id = v_vault_id;

  INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), 'secret_deleted', 'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));

  RETURN TRUE;
END;
$$;

-- ----------------------------------------------------------------------------
-- RPC: get_account_secret(account_id, provider, key_name)
-- Returns the decrypted value. RESTRICTED to service_role (edge functions).
-- We enforce this via a runtime check on the role.
-- ----------------------------------------------------------------------------
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
  v_role TEXT;
BEGIN
  -- Only service_role may call this. Anon/authenticated must NEVER read raw secrets.
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets';
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

-- ----------------------------------------------------------------------------
-- RPC: get_account_secrets_bulk(account_id, provider)
-- Returns all key_name -> value pairs for a provider (service_role only).
-- Useful for edge functions that need multiple keys at once (e.g. Twilio SID + token).
-- ----------------------------------------------------------------------------
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
  v_role TEXT;
  v_result JSONB := '{}'::jsonb;
  r RECORD;
  v_value TEXT;
BEGIN
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role IS NULL OR v_role <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role required to read account secrets';
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

-- ----------------------------------------------------------------------------
-- RPC: list_account_secrets(account_id)
-- Returns metadata about which providers are configured (no values).
-- For the onboarding/settings UI to show "✓ ElevenLabs configured".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_account_secrets(p_account_id UUID)
RETURNS TABLE (
  provider TEXT,
  key_name TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for account %', p_account_id;
  END IF;

  RETURN QUERY
  SELECT s.provider, s.key_name, s.metadata, s.created_at, s.updated_at
  FROM public.account_secrets s
  WHERE s.account_id = p_account_id
  ORDER BY s.provider, s.key_name;
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_account_secret(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_account_secret(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_account_secrets(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_account_secret(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_secret(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_secrets(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_secret(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_secrets_bulk(UUID, TEXT) TO service_role;
