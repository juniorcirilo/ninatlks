ALTER TABLE public.voice_calls ADD COLUMN IF NOT EXISTS source_id text;
CREATE INDEX IF NOT EXISTS voice_calls_source_id_idx 
  ON public.voice_calls(source_id) WHERE source_id IS NOT NULL;