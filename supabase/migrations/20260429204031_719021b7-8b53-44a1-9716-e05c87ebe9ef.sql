UPDATE public.org_onboarding_state
SET dismissed_at = NULL,
    completed_at = NULL,
    current_step = 'welcome'
WHERE account_id = 'ca3a4cd2-eb09-4e39-a1ad-395db91e9cd4'::uuid;

INSERT INTO public.org_onboarding_state (account_id, current_step)
SELECT 'ca3a4cd2-eb09-4e39-a1ad-395db91e9cd4'::uuid, 'welcome'
WHERE NOT EXISTS (
  SELECT 1 FROM public.org_onboarding_state WHERE account_id = 'ca3a4cd2-eb09-4e39-a1ad-395db91e9cd4'::uuid
);