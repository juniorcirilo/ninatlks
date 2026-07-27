import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427120000_drop_collection_vertical.sql.
export class DropCollectionVertical20260427120000 implements MigrationInterface {
  name = 'DropCollectionVertical20260427120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Pivot: cobrAI → Nina Talks (SDR)
-- Drops the debt-collection vertical: tables, crons, and any
-- collection-only columns. Safe on a fresh remix (uses IF EXISTS).
-- ============================================================

-- 1. Unschedule cobranca crons (idempotent)
do $$
declare
  v_jobs text[] := array['nexus-crm-sync-worker', 'debtors-auto-sync-6h'];
  v_job text;
begin
  foreach v_job in array v_jobs loop
    begin
      perform cron.unschedule(v_job);
    exception
      when others then null;  -- ignore "job not found"
    end;
  end loop;
end$$;
`);
    await queryRunner.query(`
-- 2. Drop tables (cascade handles fkeys to/from these)
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
-- 3. Drop collection-specific enum types (only if leftover; tables above
-- carried these so cascade likely already removed them)
drop type if exists public.debt_status cascade;
`);
    await queryRunner.query(`
drop type if exists public.arrangement_status cascade;
`);
    await queryRunner.query(`
drop type if exists public.crm_provider cascade;
`);
    await queryRunner.query(`
-- 4. Drop any RPC functions that referenced the dropped tables (idempotent)
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
-- ============================================================
-- Note: tables that survive (used by SDR vertical):
--   contacts, conversations, messages, calls, voice_campaigns,
--   agent_personas, scheduled_meetings, accounts, account_users,
--   user_roles, profiles, invites, org_onboarding_state, ...
-- ============================================================
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'DropCollectionVertical20260427120000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
