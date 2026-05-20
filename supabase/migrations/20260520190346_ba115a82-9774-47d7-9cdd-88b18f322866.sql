ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS retry_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.voice_campaigns.retry_rules IS
  'Per-outcome retry config: { "no_answer": {"max_attempts":3,"delay_minutes":60}, ... }. Empty = use campaign-level retry_attempts/retry_delay_minutes.';
