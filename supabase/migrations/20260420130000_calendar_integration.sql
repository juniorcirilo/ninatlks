-- ============================================================
-- Phase 3.1 — Calendar integrations
-- ============================================================
-- Caches upcoming meetings from Calendly / Google Calendar / generic
-- providers so we can fire no-show workflows after the fact. Providers
-- rarely emit a native `no_show` event, so we roll our own detection via
-- a cron tick that scans meetings past their end_at without attended status.

-- ─────────────────────────────────────────────────────────────
-- 1. scheduled_meetings — the one source of truth for upcoming meetings
-- ─────────────────────────────────────────────────────────────
create table if not exists public.scheduled_meetings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,

  provider text not null,                       -- 'calendly' | 'google_calendar' | 'outlook' | 'generic'
  provider_event_id text not null,              -- external id
  event_type_uri text,                          -- Calendly event type URI or Google calendarId
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  meeting_url text,

  invitee_name text,
  invitee_email text,
  invitee_phone text,

  status text not null default 'scheduled'
    check (status in ('scheduled','canceled','attended','no_show','rescheduled')),
  cancellation_reason text,
  attended_at timestamptz,
  detected_no_show_at timestamptz,

  payload jsonb not null default '{}'::jsonb,   -- raw provider payload
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider, provider_event_id)
);

create index if not exists idx_meetings_account_starts
  on public.scheduled_meetings(account_id, starts_at);
create index if not exists idx_meetings_pending_no_show
  on public.scheduled_meetings(ends_at)
  where status = 'scheduled' and detected_no_show_at is null;
create index if not exists idx_meetings_contact
  on public.scheduled_meetings(contact_id)
  where contact_id is not null;

alter table public.scheduled_meetings enable row level security;

drop policy if exists "sm_select_member" on public.scheduled_meetings;
drop policy if exists "sm_write_member" on public.scheduled_meetings;

create policy "sm_select_member" on public.scheduled_meetings
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "sm_write_member" on public.scheduled_meetings
  for update to authenticated using (is_account_member(auth.uid(), account_id));
-- inserts via service role (adapters) — no explicit policy needed.

drop trigger if exists set_scheduled_meetings_updated_at on public.scheduled_meetings;
create trigger set_scheduled_meetings_updated_at
  before update on public.scheduled_meetings
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. calendar_integrations — one row per (account, provider) holding
--    the OAuth tokens / webhook secret / selected calendar ids.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('calendly','google_calendar','outlook','generic')),

  -- Calendly: { api_key, webhook_secret, organization_uri }
  -- Google:   { access_token, refresh_token, expires_at, calendar_ids[] }
  -- Outlook:  { access_token, refresh_token, expires_at, calendar_ids[] }
  -- Generic:  { inbound_secret }                    -- HMAC for POST /functions/v1/workflow-ingest
  config jsonb not null default '{}'::jsonb,

  -- Trigger policy — what to do when a meeting becomes a no-show
  no_show_detection_minutes integer not null default 15,
  -- ...fire workflow-ingest with event_type='meeting_no_show' N min after ends_at

  enabled boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);

alter table public.calendar_integrations enable row level security;

drop policy if exists "ci_select_member" on public.calendar_integrations;
drop policy if exists "ci_write_admin" on public.calendar_integrations;

create policy "ci_select_member" on public.calendar_integrations
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "ci_write_admin" on public.calendar_integrations
  for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));

drop trigger if exists set_calendar_integrations_updated_at on public.calendar_integrations;
create trigger set_calendar_integrations_updated_at
  before update on public.calendar_integrations
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 3. Realtime pubs so /meetings UI stays live
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='scheduled_meetings'
  ) then
    execute 'alter publication supabase_realtime add table public.scheduled_meetings';
  end if;
end $$;

alter table public.scheduled_meetings replica identity full;
