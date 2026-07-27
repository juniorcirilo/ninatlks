import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260428190206_54dac6cc-05ff-4bfa-88c8-60857ae68157.sql.
export class Migration20260428190206 implements MigrationInterface {
  name = 'Migration20260428190206';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DROP FUNCTION IF EXISTS public.set_account_secret(uuid, text, text, text, jsonb);
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.set_account_secret(
  p_account_id uuid,
  p_provider text,
  p_key_name text,
  p_value text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault'
AS $$
DECLARE
  v_existing_vault_id uuid;
  v_new_vault_id uuid;
  v_secret_name text;
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for account %', p_account_id;
  END IF;

  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    RAISE EXCEPTION 'value cannot be empty';
  END IF;

  v_secret_name := format('acct_%s_%s_%s', p_account_id, p_provider, p_key_name);

  SELECT vault_secret_id INTO v_existing_vault_id
  FROM public.account_secrets
  WHERE account_id = p_account_id
    AND provider = p_provider
    AND key_name = p_key_name;

  IF v_existing_vault_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_vault_id, p_value, v_secret_name);
    UPDATE public.account_secrets
       SET metadata = COALESCE(p_metadata, '{}'::jsonb),
           updated_at = now()
     WHERE account_id = p_account_id
       AND provider = p_provider
       AND key_name = p_key_name;
  ELSE
    v_new_vault_id := vault.create_secret(p_value, v_secret_name);
    INSERT INTO public.account_secrets (
      account_id, provider, key_name, vault_secret_id, metadata, created_by
    ) VALUES (
      p_account_id, p_provider, p_key_name, v_new_vault_id,
      COALESCE(p_metadata, '{}'::jsonb), auth.uid()
    );
  END IF;

  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (p_account_id, auth.uid(), auth.uid(), 'secret_set', 'account_secret', format('%s/%s', p_provider, p_key_name),
          'account_secret',
          format('%s/%s', p_provider, p_key_name),
          jsonb_build_object('provider', p_provider, 'key_name', p_key_name));
END;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.set_account_secret(uuid, text, text, text, jsonb) TO authenticated;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260428190206 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
