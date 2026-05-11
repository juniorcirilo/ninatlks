-- 20260424010000_confidence_threshold_default_04.sql
-- Lower default confidence threshold for agent persona deployments from 0.7 to 0.4
-- so the AI replies more often. Existing rows still on the old default (0.7) get
-- bumped to 0.4; rows with custom values (0.5, 0.6, 0.8 etc.) are left intact.

ALTER TABLE public.agent_persona_deployments
  ALTER COLUMN confidence_threshold SET DEFAULT 0.4;

UPDATE public.agent_persona_deployments
SET confidence_threshold = 0.4,
    updated_at = now()
WHERE confidence_threshold = 0.7;