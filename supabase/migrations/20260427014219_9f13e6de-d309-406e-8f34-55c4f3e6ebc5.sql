-- Garante extensões (já habilitadas, mas é defensivo)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job antigo se existir (idempotente)
SELECT cron.unschedule('debtors-auto-sync-6h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'debtors-auto-sync-6h');

-- Agenda a cada 6h: chama a rota pública que itera contas com auto_sync=true
-- e dispara debtors-sync-<provider> com service-role.
SELECT cron.schedule(
  'debtors-auto-sync-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://agentedecobranca.lovable.app/api/public/hooks/debtors-auto-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNid2JxdnhpZ29yYXFwbGR1YndkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDA0NjUsImV4cCI6MjA5MjYxNjQ2NX0.QoKsPFhbdRPkgBiYuiEVj97oK5WoHC8QhRxIzwxKD2g"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);