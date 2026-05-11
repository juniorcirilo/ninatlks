UPDATE accounts SET dialing_settings = jsonb_set(
  COALESCE(dialing_settings, '{}'::jsonb),
  '{allowed_hours_local}',
  '{"mon":[0,24],"tue":[0,24],"wed":[0,24],"thu":[0,24],"fri":[0,24],"sat":[0,24],"sun":[0,24]}'::jsonb
);