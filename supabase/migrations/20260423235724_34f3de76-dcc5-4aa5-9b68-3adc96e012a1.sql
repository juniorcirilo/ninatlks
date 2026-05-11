ALTER TABLE public.org_onboarding_state
  ADD COLUMN IF NOT EXISTS health_check_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_check_at timestamptz;