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

drop table if exists public.payment_arrangements cascade;
drop table if exists public.proposal_deliveries cascade;
drop table if exists public.debts cascade;
drop table if exists public.debtor_profiles cascade;
drop table if exists public.crm_sync_queue cascade;

drop type if exists public.debt_status cascade;
drop type if exists public.arrangement_status cascade;
drop type if exists public.crm_provider cascade;

drop function if exists public.fetch_debtors(uuid, text, integer, integer) cascade;
drop function if exists public.create_debt(uuid, jsonb, jsonb) cascade;
drop function if exists public.arrangement_approve(uuid) cascade;
drop function if exists public.arrangement_reject(uuid, text) cascade;
drop function if exists public.arrangement_mark_paid(uuid) cascade;
drop function if exists public.approve_arrangement(uuid) cascade;
drop function if exists public.reject_arrangement(uuid, text) cascade;
drop function if exists public.mark_arrangement_paid(uuid, text, text) cascade;
drop function if exists public.bump_debt_attempts(uuid) cascade;