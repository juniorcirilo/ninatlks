UPDATE accounts SET dialing_settings = 
  jsonb_set(
    jsonb_set(
      COALESCE(dialing_settings, '{}'::jsonb),
      '{min_minutes_between_attempts}', '0'::jsonb
    ),
    '{max_attempts_per_day}', '999'::jsonb
  );