-- Bump default max_tokens for existing personas — 150 era curto demais e cortava frases no meio
UPDATE public.agent_personas
SET llm_max_tokens = 400
WHERE llm_max_tokens IS NULL OR llm_max_tokens < 200;

-- Atualiza o default da coluna pra novas personas
ALTER TABLE public.agent_personas
ALTER COLUMN llm_max_tokens SET DEFAULT 400;