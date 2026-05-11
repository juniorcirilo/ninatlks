-- Fase 1: Alinhamento de schema do motor de campanhas de voz.
-- Destrava voice-campaign-start e voice-campaign-dispatch (campos referenciados
-- no código que não existiam na tabela), corrige incompatibilidade de tipo
-- (voice_call_id BIGINT → UUID), e registra o cron do dispatcher.

-- 1) voice_campaigns: campos que o código já tenta gravar
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS language_code text NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS script_mode text NOT NULL DEFAULT 'conversational',
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS phone_number_id uuid REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS escalation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS max_call_duration_sec integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS voicemail_detection boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS triggered_by_id uuid,
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS contact_count integer NOT NULL DEFAULT 0;

-- Atualiza CHECK do script_mode pra aceitar os 3 modos
ALTER TABLE public.voice_campaigns DROP CONSTRAINT IF EXISTS voice_campaigns_mode_check;
ALTER TABLE public.voice_campaigns
  ADD CONSTRAINT voice_campaigns_script_mode_check
  CHECK (script_mode IN ('script_readback', 'conversational', 'hybrid'));

-- Atualiza CHECK do status pra incluir 'canceled' (variação americana usada no client)
ALTER TABLE public.voice_campaigns DROP CONSTRAINT IF EXISTS voice_campaigns_status_check;
ALTER TABLE public.voice_campaigns
  ADD CONSTRAINT voice_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled', 'canceled'));

-- Mantém scheduled_for em sync com scheduled_at (legado)
CREATE OR REPLACE FUNCTION public.tg_voice_campaign_sync_scheduled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.scheduled_for IS NOT NULL AND NEW.scheduled_at IS NULL THEN
    NEW.scheduled_at := NEW.scheduled_for;
  ELSIF NEW.scheduled_at IS NOT NULL AND NEW.scheduled_for IS NULL THEN
    NEW.scheduled_for := NEW.scheduled_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_voice_campaign_sync_scheduled ON public.voice_campaigns;
CREATE TRIGGER trg_voice_campaign_sync_scheduled
  BEFORE INSERT OR UPDATE ON public.voice_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_voice_campaign_sync_scheduled();

-- 2) voice_campaign_contacts: campos que o código já tenta gravar + UUID FK
ALTER TABLE public.voice_campaign_contacts
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dispatch_after timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Backfill phone_number a partir de to_number (legado)
UPDATE public.voice_campaign_contacts
   SET phone_number = to_number
 WHERE phone_number IS NULL AND to_number IS NOT NULL;

-- Conserta tipo de voice_call_id (BIGINT → UUID). Drop column é seguro: zero linhas
-- têm valor populado nesse campo (campanhas em massa nunca rodaram com sucesso).
ALTER TABLE public.voice_campaign_contacts DROP COLUMN IF EXISTS voice_call_id;
ALTER TABLE public.voice_campaign_contacts
  ADD COLUMN voice_call_id uuid REFERENCES public.voice_calls(id) ON DELETE SET NULL;

-- Constraint única pra suportar upsert ON CONFLICT (campaign_id, contact_id)
CREATE UNIQUE INDEX IF NOT EXISTS voice_campaign_contacts_campaign_contact_uniq
  ON public.voice_campaign_contacts(campaign_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- Index parcial otimizado pro scan do dispatcher
DROP INDEX IF EXISTS public.idx_vcc_dispatch_queue;
CREATE INDEX IF NOT EXISTS idx_vcc_dispatch_ready
  ON public.voice_campaign_contacts(dispatch_after, campaign_id)
  WHERE status = 'queued';

-- 3) Job pg_cron: dispatcher a cada minuto
SELECT public.schedule_edge_cron(
  'nexus-voice-campaign-dispatch',
  '* * * * *',
  'voice-campaign-dispatch',
  '{}'::jsonb
);