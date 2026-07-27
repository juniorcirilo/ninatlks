SELECT cron.unschedule('voice-calls-finalize-pending');

SELECT cron.schedule(
  'voice-calls-finalize-pending',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--975b0cb1-8180-4007-a7ad-ebcba2bc4122-dev.lovable.app/api/public/hooks/voice-calls-finalize-pending',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);