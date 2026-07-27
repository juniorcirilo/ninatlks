select public.schedule_edge_cron(
  'nexus-crm-sync-worker',
  '* * * * *',
  'crm-sync-worker',
  '{}'::jsonb
);
