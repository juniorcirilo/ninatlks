-- ============================================================
-- Phase 4 — CRM sync (Pipedrive + HubSpot) — bidirectional
-- ============================================================
-- The external CRM is the source of truth for deals/pipelines/tasks. We keep
-- a thin mirror so workflow conditions ("deal.stage == qualified") and
-- dashboards don't have to hit the external API on every check.

-- ─────────────────────────────────────────────────────────────
-- 1. crm_integrations — per (account, provider). Holds API key / OAuth
--    tokens + selected pipelines/fields.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('pipedrive','hubspot')),

  -- Pipedrive: { api_token, company_domain, webhook_secret, default_pipeline_id, default_user_id }
  -- HubSpot:   { access_token, refresh_token, expires_at, portal_id, webhook_secret, default_pipeline }
  config jsonb not null default '{}'::jsonb,

  -- Field mapping: how a contact.custom_attributes.X maps to CRM custom field Y
  field_map jsonb not null default '{}'::jsonb,

  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);

alter table public.crm_integrations enable row level security;
drop policy if exists "crm_select_member" on public.crm_integrations;
drop policy if exists "crm_write_admin" on public.crm_integrations;
create policy "crm_select_member" on public.crm_integrations
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "crm_write_admin" on public.crm_integrations
  for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
drop trigger if exists set_crm_integrations_updated_at on public.crm_integrations;
create trigger set_crm_integrations_updated_at
  before update on public.crm_integrations
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. crm_pipelines + crm_pipeline_stages — mirror of CRM pipeline
--    structure so workflow actions can reference stage by name/id.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null,
  provider_pipeline_id text not null,
  name text not null,
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider, provider_pipeline_id)
);

create table if not exists public.crm_pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null,
  provider_stage_id text not null,
  name text not null,
  order_index integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (pipeline_id, provider_stage_id)
);

alter table public.crm_pipelines enable row level security;
alter table public.crm_pipeline_stages enable row level security;

drop policy if exists "cp_select_member" on public.crm_pipelines;
drop policy if exists "cps_select_member" on public.crm_pipeline_stages;
create policy "cp_select_member" on public.crm_pipelines
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "cps_select_member" on public.crm_pipeline_stages
  for select to authenticated using (is_account_member(auth.uid(), account_id));

-- ─────────────────────────────────────────────────────────────
-- 3. crm_deals — the local mirror
-- ─────────────────────────────────────────────────────────────
create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  pipeline_id uuid references public.crm_pipelines(id) on delete set null,
  stage_id uuid references public.crm_pipeline_stages(id) on delete set null,

  provider text not null,
  provider_deal_id text not null,
  title text not null,
  value_cents integer,
  currency text default 'BRL',
  status text not null default 'open'
    check (status in ('open','won','lost','deleted')),
  owner_id text,                                 -- external CRM user id
  expected_close_date date,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,

  -- Last sync direction: 'inbound' when the CRM pushed a change to us,
  -- 'outbound' when we pushed to the CRM. Helps debug loops.
  last_sync_direction text,
  last_synced_at timestamptz,

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider, provider_deal_id)
);

create index if not exists idx_crm_deals_account_status
  on public.crm_deals(account_id, status, updated_at desc);
create index if not exists idx_crm_deals_contact
  on public.crm_deals(contact_id) where contact_id is not null;

alter table public.crm_deals enable row level security;
drop policy if exists "cd_select_member" on public.crm_deals;
drop policy if exists "cd_write_member" on public.crm_deals;
create policy "cd_select_member" on public.crm_deals
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "cd_write_member" on public.crm_deals
  for update to authenticated using (is_account_member(auth.uid(), account_id));
drop trigger if exists set_crm_deals_updated_at on public.crm_deals;
create trigger set_crm_deals_updated_at
  before update on public.crm_deals
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. crm_sync_queue — outbound work queue for CRM writes from Nexus.
--    When deal.move_stage action fires, we enqueue here; a worker
--    (cron-driven) processes + pushes to CRM. Isolates Nexus from CRM
--    API flakiness.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.crm_sync_queue (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null,
  operation text not null
    check (operation in (
      'deal.create','deal.update','deal.move_stage','deal.win','deal.lose',
      'contact.upsert','activity.create'
    )),
  target jsonb not null default '{}'::jsonb,        -- e.g. { deal_id, contact_id, stage_id }
  payload jsonb not null default '{}'::jsonb,        -- fields to write
  status text not null default 'pending'
    check (status in ('pending','running','done','failed','canceled')),
  attempts int not null default 0,
  last_error text,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_sync_queue_ready
  on public.crm_sync_queue(account_id, scheduled_for)
  where status = 'pending';

alter table public.crm_sync_queue enable row level security;
drop policy if exists "csq_select_admin" on public.crm_sync_queue;
create policy "csq_select_admin" on public.crm_sync_queue
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

drop trigger if exists set_crm_sync_queue_updated_at on public.crm_sync_queue;
create trigger set_crm_sync_queue_updated_at
  before update on public.crm_sync_queue
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. Realtime for the UI
-- ─────────────────────────────────────────────────────────────
do $$
begin
  for t in select unnest(array['crm_deals','crm_pipelines','crm_pipeline_stages','crm_sync_queue']) loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.crm_deals replica identity full;
alter table public.crm_pipelines replica identity full;
alter table public.crm_pipeline_stages replica identity full;
