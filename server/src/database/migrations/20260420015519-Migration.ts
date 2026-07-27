import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420015519_0ac93cdf-c95f-42f3-ad9e-827239c63822.sql.
export class Migration20260420015519 implements MigrationInterface {
  name = 'Migration20260420015519';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- View foi flagada como SECURITY DEFINER VIEW (anti-pattern). Removemos
-- e o frontend chama nexus_cron_status() diretamente via RPC.
DROP VIEW IF EXISTS public.nexus_cron_jobs;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420015519 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
