import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427203339_8fd2f692-7988-4e22-af48-a46f2a4fbd16.sql.
export class Migration20260427203339 implements MigrationInterface {
  name = 'Migration20260427203339';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Pivot cobrAI → Nina Talks: drop debt-collection vertical
do $$
declare
  v_jobs text[] := array['nexus-crm-sync-worker', 'debtors-auto-sync-6h'];
  v_job text;
begin
  foreach v_job in array v_jobs loop
    begin
      perform cron.unschedule(v_job);
    exception
      when others then null;
    end;
  end loop;
end$$;
`);
    await queryRunner.query(`
drop table if exists public.payment_arrangements cascade;
`);
    await queryRunner.query(`
drop table if exists public.proposal_deliveries cascade;
`);
    await queryRunner.query(`
drop table if exists public.debts cascade;
`);
    await queryRunner.query(`
drop table if exists public.debtor_profiles cascade;
`);
    await queryRunner.query(`
drop table if exists public.crm_sync_queue cascade;
`);
    await queryRunner.query(`
drop type if exists public.debt_status cascade;
`);
    await queryRunner.query(`
drop type if exists public.arrangement_status cascade;
`);
    await queryRunner.query(`
drop type if exists public.crm_provider cascade;
`);
    await queryRunner.query(`
drop function if exists public.fetch_debtors(uuid, text, integer, integer) cascade;
`);
    await queryRunner.query(`
drop function if exists public.create_debt(uuid, jsonb, jsonb) cascade;
`);
    await queryRunner.query(`
drop function if exists public.arrangement_approve(uuid) cascade;
`);
    await queryRunner.query(`
drop function if exists public.arrangement_reject(uuid, text) cascade;
`);
    await queryRunner.query(`
drop function if exists public.arrangement_mark_paid(uuid) cascade;
`);
    await queryRunner.query(`
drop function if exists public.approve_arrangement(uuid) cascade;
`);
    await queryRunner.query(`
drop function if exists public.reject_arrangement(uuid, text) cascade;
`);
    await queryRunner.query(`
drop function if exists public.mark_arrangement_paid(uuid, text, text) cascade;
`);
    await queryRunner.query(`
drop function if exists public.bump_debt_attempts(uuid) cascade;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260427203339 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
