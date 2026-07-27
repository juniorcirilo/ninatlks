ALTER TABLE public.voice_campaigns DROP CONSTRAINT IF EXISTS voice_campaigns_campaign_kind_check;
ALTER TABLE public.voice_campaigns ADD CONSTRAINT voice_campaigns_campaign_kind_check
  CHECK (campaign_kind IS NULL OR campaign_kind = ANY (ARRAY['sdr','pos_venda','cobranca','retencao','custom','collection','other']));