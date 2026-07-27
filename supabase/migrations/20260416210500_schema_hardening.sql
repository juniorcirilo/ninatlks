-- ============================================================
-- Schema hardening: companies, FKs, indexes, audit log
-- ============================================================
-- Additive migration — safe to run on an existing database. Every statement
-- is guarded by IF EXISTS/IF NOT EXISTS so re-runs are idempotent.

-- ─────────────────────────────────────────────────────────────
-- 1. companies (to back contacts.company_id)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  website text,
  industry text,
  location text,
  custom_attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_companies_account on public.companies(account_id);

alter table public.companies enable row level security;

drop policy if exists "companies_select_member" on public.companies;
drop policy if exists "companies_insert_member" on public.companies;
drop policy if exists "companies_update_member" on public.companies;
drop policy if exists "companies_delete_admin"  on public.companies;

create policy "companies_select_member" on public.companies
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "companies_insert_member" on public.companies
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
create policy "companies_update_member" on public.companies
  for update to authenticated using (is_account_member(auth.uid(), account_id));
create policy "companies_delete_admin"  on public.companies
  for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at
  before update on public.companies
  for each row execute function public.tg_set_updated_at();

-- Contacts FK to companies (nullable; SET NULL on delete preserves contacts).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_contacts_company'
  ) then
    alter table public.contacts
      add constraint fk_contacts_company
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Tighten notifications.user_id FK
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_notifications_user'
  ) then
    -- Clean any orphans before adding FK (shouldn't exist but safer).
    delete from public.notifications
     where user_id is not null
       and not exists (select 1 from auth.users u where u.id = public.notifications.user_id);

    alter table public.notifications
      add constraint fk_notifications_user
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Missing indexes
-- ─────────────────────────────────────────────────────────────
create index if not exists idx_contacts_identifier
  on public.contacts(account_id, identifier);

create index if not exists idx_messages_sender
  on public.messages(sender_id, created_at desc)
  where sender_id is not null;

create index if not exists idx_cmn_contact
  on public.customer_memory_nodes(contact_id);

create index if not exists idx_conversations_account_status
  on public.conversations(account_id, status, last_activity_at desc);

create index if not exists idx_campaign_runs_account_finished
  on public.campaign_runs(account_id, finished_at desc);

-- ─────────────────────────────────────────────────────────────
-- 4. Status documentation — keep smallint but add comments
--     so smallint values remain self-describing for ops/debug.
-- ─────────────────────────────────────────────────────────────
comment on column public.conversations.status is
  'Status code — 0:open, 1:resolved, 2:pending, 3:snoozed';

comment on column public.messages.message_type is
  'Message direction — 0:incoming (customer), 1:outgoing (agent/AI), 2:system';

comment on column public.messages.content_type is
  'Content kind — 0:text, 1:image, 2:file, 3:video, 4:audio, 5:card';

-- ─────────────────────────────────────────────────────────────
-- 5. audit_log (append-only, service-role inserts, member-visible reads)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  actor_id uuid,
  entity_type text not null,
  entity_id text,
  action varchar(24) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_account_created
  on public.audit_log(account_id, created_at desc);
create index if not exists idx_audit_log_entity
  on public.audit_log(account_id, entity_type, entity_id, created_at desc);

alter table public.audit_log enable row level security;

drop policy if exists "audit_select_admin" on public.audit_log;
create policy "audit_select_admin" on public.audit_log
  for select to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role));
-- No insert/update/delete policies: writes only via service_role.
