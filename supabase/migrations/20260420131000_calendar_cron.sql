-- Meetings no-show detection runs every 5 min.
select public.schedule_edge_cron(
  'nexus-meetings-noshow-tick',
  '*/5 * * * *',
  'meetings-noshow-tick',
  '{}'::jsonb
);
