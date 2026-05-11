-- Cron that picks up queued voice_campaign_contacts and places the calls.
select public.schedule_edge_cron(
  'nexus-voice-campaign-dispatch',
  '* * * * *',
  'voice-campaign-dispatch',
  '{}'::jsonb
);
