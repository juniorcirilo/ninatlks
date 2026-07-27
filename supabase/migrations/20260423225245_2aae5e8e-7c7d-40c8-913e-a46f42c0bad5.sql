-- Fase 2: configurações de discagem por workspace + unique em DNC.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS dialing_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.accounts.dialing_settings IS
  'Voice guard defaults: { timezone, allowed_hours_local{mon..sun:[h0,h1]|null}, max_attempts_per_day, min_minutes_between_attempts }. Vazio = defaults BR.';

-- Garante unique (account_id, phone_number) em dnc_list. Já existe desde
-- migration anterior mas roda idempotente caso schema esteja drift.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='dnc_list'
      AND indexname='dnc_list_account_id_phone_number_key'
  ) THEN
    ALTER TABLE public.dnc_list
      ADD CONSTRAINT dnc_list_account_id_phone_number_key
      UNIQUE (account_id, phone_number);
  END IF;
END$$;