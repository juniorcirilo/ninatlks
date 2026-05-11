-- E7: Track when a campaign was canceled and how many calls had been placed at that point
ALTER TABLE public.voice_campaigns
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_after_placed integer,
  ADD COLUMN IF NOT EXISTS test_mode boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_voice_campaigns_test_mode
  ON public.voice_campaigns (account_id, test_mode)
  WHERE test_mode = true;