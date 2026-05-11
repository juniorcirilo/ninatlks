-- ============================================================
-- Helper schedule_edge_cron (caso não exista)
-- ============================================================
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

create or replace function public.schedule_edge_cron(
  p_name text,
  p_schedule text,
  p_function text,
  p_body jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_existing bigint;
begin
  select jobid into v_existing from cron.job where jobname = p_name;
  if v_existing is not null then perform cron.unschedule(v_existing); end if;
  perform cron.schedule(p_name, p_schedule, format(
    $cmd$
    select net.http_post(
      url := current_setting('app.supabase_url', true) || '/functions/v1/%s',
      headers := jsonb_build_object('Content-Type','application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)),
      body := %L::jsonb
    );
    $cmd$, p_function, p_body::text));
end;
$$;

-- ============================================================
-- Phase 2 — Voice compliance (BR)
-- ============================================================
create table if not exists public.dnc_list (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number text not null,
  reason text, added_by uuid, source text, notes text,
  created_at timestamptz not null default now(),
  unique (account_id, phone_number)
);
create index if not exists idx_dnc_account on public.dnc_list(account_id);
alter table public.dnc_list enable row level security;
drop policy if exists "dnc_select_member" on public.dnc_list;
drop policy if exists "dnc_insert_member" on public.dnc_list;
drop policy if exists "dnc_delete_admin" on public.dnc_list;
create policy "dnc_select_member" on public.dnc_list for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "dnc_insert_member" on public.dnc_list for insert to authenticated with check (is_account_member(auth.uid(), account_id));
create policy "dnc_delete_admin" on public.dnc_list for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

alter table public.contacts add column if not exists timezone text default 'America/Sao_Paulo';

create table if not exists public.call_attempts_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  phone_number text not null, campaign_id uuid, voice_call_id uuid,
  attempt_at timestamptz not null default now(), outcome text
);
create index if not exists idx_attempts_account_phone_date on public.call_attempts_log(account_id, phone_number, attempt_at desc);
create index if not exists idx_attempts_account_date on public.call_attempts_log(account_id, attempt_at desc);
alter table public.call_attempts_log enable row level security;
drop policy if exists "cal_select_admin" on public.call_attempts_log;
create policy "cal_select_admin" on public.call_attempts_log for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

alter table public.voice_campaigns
  add column if not exists allowed_hours_local jsonb,
  add column if not exists max_attempts_per_day integer,
  add column if not exists min_minutes_between_attempts integer,
  add column if not exists disclaimer_enabled boolean default true;

create or replace function public.is_phone_allowed_to_call(
  p_account_id uuid, p_phone_number text,
  p_timezone text default 'America/Sao_Paulo',
  p_allowed_hours_local jsonb default null,
  p_max_attempts_per_day integer default 2,
  p_min_minutes_between_attempts integer default 120
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_now_local timestamptz := (now() at time zone p_timezone);
  v_dow text := lower(to_char(v_now_local, 'dy'));
  v_hour int := extract(hour from v_now_local);
  v_hours_range jsonb; v_start int; v_end int;
  v_attempts_today int; v_last_attempt_at timestamptz; v_dnc_hit int;
begin
  select count(*) into v_dnc_hit from public.dnc_list where account_id = p_account_id and phone_number = p_phone_number;
  if v_dnc_hit > 0 then return jsonb_build_object('allowed', false, 'reason', 'dnc'); end if;

  if p_allowed_hours_local is not null then
    v_hours_range := p_allowed_hours_local -> v_dow;
    if v_hours_range is null or jsonb_typeof(v_hours_range) = 'null' then
      return jsonb_build_object('allowed', false, 'reason', 'outside_allowed_day');
    end if;
    v_start := (v_hours_range -> 0)::int; v_end := (v_hours_range -> 1)::int;
    if v_hour < v_start or v_hour >= v_end then
      return jsonb_build_object('allowed', false, 'reason', 'outside_allowed_hours',
        'allowed_range', v_hours_range, 'now_hour_local', v_hour);
    end if;
  end if;

  select count(*), max(attempt_at) into v_attempts_today, v_last_attempt_at
    from public.call_attempts_log
   where account_id = p_account_id and phone_number = p_phone_number
     and attempt_at >= date_trunc('day', now());
  if v_attempts_today >= p_max_attempts_per_day then
    return jsonb_build_object('allowed', false, 'reason', 'max_attempts_today',
      'attempts', v_attempts_today, 'cap', p_max_attempts_per_day);
  end if;

  if v_last_attempt_at is not null
     and (extract(epoch from (now() - v_last_attempt_at)) / 60) < p_min_minutes_between_attempts then
    return jsonb_build_object('allowed', false, 'reason', 'too_soon',
      'last_attempt_at', v_last_attempt_at, 'min_gap_minutes', p_min_minutes_between_attempts);
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.is_phone_allowed_to_call(uuid, text, text, jsonb, integer, integer) from public;
grant execute on function public.is_phone_allowed_to_call(uuid, text, text, jsonb, integer, integer) to authenticated, service_role;

create or replace function public.tg_sms_optout_to_dnc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.dnc_list (account_id, phone_number, reason, source, notes)
  values (new.account_id, new.phone_number, 'stop_reply', 'sms_opt_out', new.reason)
  on conflict (account_id, phone_number) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_sms_optout_to_dnc on public.sms_opt_outs;
create trigger trg_sms_optout_to_dnc
  after insert on public.sms_opt_outs
  for each row when (new.opted_back_in_at is null)
  execute function public.tg_sms_optout_to_dnc();

-- ============================================================
-- Phase 3.1 — Calendar integrations
-- ============================================================
create table if not exists public.scheduled_meetings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  provider text not null, provider_event_id text not null,
  event_type_uri text, title text,
  starts_at timestamptz not null, ends_at timestamptz, meeting_url text,
  invitee_name text, invitee_email text, invitee_phone text,
  status text not null default 'scheduled' check (status in ('scheduled','canceled','attended','no_show','rescheduled')),
  cancellation_reason text, attended_at timestamptz, detected_no_show_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, provider, provider_event_id)
);
create index if not exists idx_meetings_account_starts on public.scheduled_meetings(account_id, starts_at);
create index if not exists idx_meetings_pending_no_show on public.scheduled_meetings(ends_at) where status = 'scheduled' and detected_no_show_at is null;
create index if not exists idx_meetings_contact on public.scheduled_meetings(contact_id) where contact_id is not null;
alter table public.scheduled_meetings enable row level security;
drop policy if exists "sm_select_member" on public.scheduled_meetings;
drop policy if exists "sm_write_member" on public.scheduled_meetings;
create policy "sm_select_member" on public.scheduled_meetings for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "sm_write_member" on public.scheduled_meetings for update to authenticated using (is_account_member(auth.uid(), account_id));
drop trigger if exists set_scheduled_meetings_updated_at on public.scheduled_meetings;
create trigger set_scheduled_meetings_updated_at before update on public.scheduled_meetings
  for each row execute function public.tg_set_updated_at();

create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('calendly','google_calendar','outlook','generic')),
  config jsonb not null default '{}'::jsonb,
  no_show_detection_minutes integer not null default 15,
  enabled boolean not null default true, last_synced_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (account_id, provider)
);
alter table public.calendar_integrations enable row level security;
drop policy if exists "ci_select_member" on public.calendar_integrations;
drop policy if exists "ci_write_admin" on public.calendar_integrations;
create policy "ci_select_member" on public.calendar_integrations for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "ci_write_admin" on public.calendar_integrations for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
drop trigger if exists set_calendar_integrations_updated_at on public.calendar_integrations;
create trigger set_calendar_integrations_updated_at before update on public.calendar_integrations
  for each row execute function public.tg_set_updated_at();

do $$
begin
  if not exists (select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='scheduled_meetings') then
    execute 'alter publication supabase_realtime add table public.scheduled_meetings';
  end if;
end $$;
alter table public.scheduled_meetings replica identity full;

-- Calendar cron
select public.schedule_edge_cron(
  'nexus-meetings-noshow-tick', '*/5 * * * *', 'meetings-noshow-tick', '{}'::jsonb
);