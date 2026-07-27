import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427014219_9f13e6de-d309-406e-8f34-55c4f3e6ebc5.sql. Lines requiring Supabase-platform-only extensions were
// commented out and replaced by scripts/db/00-compat-shims.sql equivalents:
//   CREATE EXTENSION IF NOT EXISTS pg_cron;
//   CREATE EXTENSION IF NOT EXISTS pg_net;
export class Migration20260427014219 implements MigrationInterface {
  name = 'Migration20260427014219';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Garante extensões (já habilitadas, mas é defensivo)
-- [stripped by generate-typeorm-migrations.mjs, see scripts/db/00-compat-shims.sql]: CREATE EXTENSION IF NOT EXISTS pg_cron;
-- [stripped by generate-typeorm-migrations.mjs, see scripts/db/00-compat-shims.sql]: CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove job antigo se existir (idempotente)
SELECT cron.unschedule('debtors-auto-sync-6h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'debtors-auto-sync-6h');
`);
    await queryRunner.query(`
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
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260427014219 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
