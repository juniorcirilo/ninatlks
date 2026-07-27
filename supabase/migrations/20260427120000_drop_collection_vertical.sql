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

-- 2. Drop tables (cascade handles fkeys to/from these)
drop table if exists public.payment_arrangements cascade;
drop table if exists public.proposal_deliveries cascade;
drop table if exists public.debts cascade;
drop table if exists public.debtor_profiles cascade;
drop table if exists public.crm_sync_queue cascade;

-- 3. Drop collection-specific enum types (only if leftover; tables above
-- carried these so cascade likely already removed them)
drop type if exists public.debt_status cascade;
drop type if exists public.arrangement_status cascade;
drop type if exists public.crm_provider cascade;

-- 4. Drop any RPC functions that referenced the dropped tables (idempotent)
drop function if exists public.fetch_debtors(uuid, text, integer, integer) cascade;
drop function if exists public.create_debt(uuid, jsonb, jsonb) cascade;
drop function if exists public.arrangement_approve(uuid) cascade;
drop function if exists public.arrangement_reject(uuid, text) cascade;
drop function if exists public.arrangement_mark_paid(uuid) cascade;

-- ============================================================
-- Note: tables that survive (used by SDR vertical):
--   contacts, conversations, messages, calls, voice_campaigns,
--   agent_personas, scheduled_meetings, accounts, account_users,
--   user_roles, profiles, invites, org_onboarding_state, ...
-- ============================================================
