UPDATE public.accounts
SET dialing_settings = jsonb_build_object(
  'timezone', COALESCE(dialing_settings->>'timezone', 'America/Sao_Paulo'),
  'allowed_hours_local', jsonb_build_object(
    'mon', jsonb_build_array(0, 24),
    'tue', jsonb_build_array(0, 24),
    'wed', jsonb_build_array(0, 24),
    'thu', jsonb_build_array(0, 24),
    'fri', jsonb_build_array(0, 24),
    'sat', jsonb_build_array(0, 24),
    'sun', jsonb_build_array(0, 24)
  ),
  'max_attempts_per_day', 999,
  'min_minutes_between_attempts', 0
)
WHERE dialing_settings IS NULL
   OR dialing_settings = '{}'::jsonb
   OR NOT (dialing_settings ? 'allowed_hours_local');