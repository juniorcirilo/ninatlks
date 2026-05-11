-- 1) Origem e última sincronização das dívidas
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Idempotência por (account_id, external_ref) para upsert nos pulls
CREATE UNIQUE INDEX IF NOT EXISTS uq_debts_account_external_ref
  ON public.debts(account_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- 2) Fila de push bidirecional (status local → CRM/Asaas)
CREATE TABLE IF NOT EXISTS public.integration_sync_queue (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL,
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,                  -- hubspot | pipedrive | asaas
  external_ref TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_isq_pending
  ON public.integration_sync_queue(status, created_at)
  WHERE status = 'pending';

ALTER TABLE public.integration_sync_queue ENABLE ROW LEVEL SECURITY;

-- Só admins lêem (debug); writes são via service_role nas edge functions
DROP POLICY IF EXISTS isq_select_admin ON public.integration_sync_queue;
CREATE POLICY isq_select_admin ON public.integration_sync_queue
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));

-- 3) Trigger: enfileira quando status muda para terminais e tem external_ref
CREATE OR REPLACE FUNCTION public.tg_enqueue_debt_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT;
BEGIN
  IF NEW.external_ref IS NULL THEN
    RETURN NEW;
  END IF;

  -- Deriva provider pelo prefixo do external_ref
  IF NEW.external_ref LIKE 'hubspot:%' THEN v_provider := 'hubspot';
  ELSIF NEW.external_ref LIKE 'pipedrive:%' THEN v_provider := 'pipedrive';
  ELSIF NEW.external_ref LIKE 'asaas:%' THEN v_provider := 'asaas';
  ELSE
    RETURN NEW; -- sem provider mapeado, ignora
  END IF;

  IF NEW.status::text NOT IN ('pago','acordado','cancelado') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT NULL AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.integration_sync_queue
    (account_id, debt_id, provider, external_ref, payload)
  VALUES (
    NEW.account_id, NEW.id, v_provider, NEW.external_ref,
    jsonb_build_object(
      'from_status', OLD.status::text,
      'to_status',   NEW.status::text,
      'valor_atual', NEW.valor_atual,
      'descricao',   NEW.descricao
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_debt_status_push ON public.debts;
CREATE TRIGGER tg_debt_status_push
AFTER UPDATE OF status ON public.debts
FOR EACH ROW
EXECUTE FUNCTION public.tg_enqueue_debt_sync();