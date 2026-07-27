DO $$
DECLARE
  v_url text := 'https://rjcgdesoiujrvtsjrgdy.supabase.co/functions/v1/voice-campaign-dispatch';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqY2dkZXNvaXVqcnZ0c2pyZ2R5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTE3OTYsImV4cCI6MjA5MTkyNzc5Nn0.4drXSClorhl5BIwrggMtZtak7B1ZeOnDXtC11b3hO7Y';
BEGIN
  -- Unschedule if already exists (idempotent)
  PERFORM cron.unschedule('nexus-voice-campaign-dispatch')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nexus-voice-campaign-dispatch');

  PERFORM cron.schedule(
    'nexus-voice-campaign-dispatch',
    '* * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := '{"trigger":"cron"}'::jsonb
      );
    $job$, v_url, v_anon)
  );
END $$;