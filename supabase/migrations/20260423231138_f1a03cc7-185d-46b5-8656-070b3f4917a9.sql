-- Add outcome categorization columns to voice_calls
ALTER TABLE public.voice_calls
  ADD COLUMN IF NOT EXISTS outcome_category text,
  ADD COLUMN IF NOT EXISTS outcome_confidence real,
  ADD COLUMN IF NOT EXISTS outcome_summary text,
  ADD COLUMN IF NOT EXISTS outcome_classified_at timestamptz;

-- Constraint on allowed categories (drop first to make idempotent)
ALTER TABLE public.voice_calls
  DROP CONSTRAINT IF EXISTS voice_calls_outcome_category_check;

ALTER TABLE public.voice_calls
  ADD CONSTRAINT voice_calls_outcome_category_check
  CHECK (outcome_category IS NULL OR outcome_category IN (
    'interested',
    'not_interested',
    'callback_requested',
    'voicemail',
    'wrong_number',
    'do_not_call',
    'no_answer',
    'busy',
    'failed',
    'escalated',
    'other'
  ));

-- Partial index for analytics queries
CREATE INDEX IF NOT EXISTS idx_voice_calls_outcome_category
  ON public.voice_calls (account_id, outcome_category, outcome_classified_at DESC)
  WHERE outcome_category IS NOT NULL;

-- Set replica identity full so realtime payloads include all columns
ALTER TABLE public.voice_calls REPLICA IDENTITY FULL;
ALTER TABLE public.voice_campaign_contacts REPLICA IDENTITY FULL;

-- Add to realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_calls;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_campaign_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_campaign_contacts;
  END IF;
END $$;