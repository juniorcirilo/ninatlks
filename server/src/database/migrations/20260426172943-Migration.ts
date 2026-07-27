import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426172943_7dd4768d-d1b5-4b7c-be25-b1739fe710c8.sql.
export class Migration20260426172943 implements MigrationInterface {
  name = 'Migration20260426172943';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Corrige set_account_secret: vault.create_secret/update_secret exigem description NOT NULL.
-- Passa uma description gerada baseada em (provider, key_name, account_id).

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
  v_secret_description TEXT;
BEGIN
  -- Authorization: only admins of the account
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for account %', p_account_id;
  END IF;

  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    RAISE EXCEPTION 'value cannot be empty';
  END IF;

  SELECT vault_secret_id INTO v_existing_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id
    AND provider = p_provider
    AND key_name = p_key_name;

  v_secret_name := format('account_%s_%s_%s', p_account_id, p_provider, p_key_name);
  v_secret_description := format(
    'Per-account secret for provider=%s key=%s account=%s',
    p_provider, p_key_name, p_account_id
  );

  IF v_existing_vault_id IS NOT NULL THEN
    -- Pass a non-null description: vault.secrets.description has NOT NULL constraint
    PERFORM vault.update_secret(v_existing_vault_id, p_value, v_secret_name, v_secret_description);

    UPDATE public.account_secrets
       SET metadata = COALESCE(p_metadata, '{}'::jsonb),
           updated_at = now()
     WHERE account_id = p_account_id
       AND provider = p_provider
       AND key_name = p_key_name;

    RETURN v_existing_vault_id;
  ELSE
    v_new_vault_id := vault.create_secret(p_value, v_secret_name, v_secret_description);

    INSERT INTO public.account_secrets (
      account_id, provider, key_name, vault_secret_id, metadata, created_by
    ) VALUES (
      p_account_id, p_provider, p_key_name, v_new_vault_id,
      COALESCE(p_metadata, '{}'::jsonb), auth.uid()
    );

    INSERT INTO public.audit_log (account_id, user_id, action, resource_type, resource_id, metadata)
    VALUES (p_account_id, auth.uid(), 'secret_created', 'account_secret',
            format('%s/%s', p_provider, p_key_name),
            jsonb_build_object('provider', p_provider, 'key_name', p_key_name));

    RETURN v_new_vault_id;
  END IF;
END;
$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426172943 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
