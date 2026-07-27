ALTER TABLE public.agent_personas
  ADD COLUMN IF NOT EXISTS first_message text,
  ADD COLUMN IF NOT EXISTS turn_config jsonb NOT NULL DEFAULT '{"turn_timeout":3,"turn_eagerness":"eager","silence_end_call_timeout":30}'::jsonb,
  ADD COLUMN IF NOT EXISTS tts_config jsonb NOT NULL DEFAULT '{"stability":0.35,"speed":1.05,"similarity_boost":0.85}'::jsonb,
  ADD COLUMN IF NOT EXISTS asr_keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS llm_temperature numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS llm_max_tokens integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS llm_model text NOT NULL DEFAULT 'gemini-2.5-flash';