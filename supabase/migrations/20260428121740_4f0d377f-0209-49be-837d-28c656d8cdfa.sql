-- Sprint 3 — Calendário próprio + agendamento de reuniões SDR
-- (idempotente; profile names corrigidos para coalesce(display_name,name,email))

-- 1. scheduled_meetings deltas
alter table public.scheduled_meetings
  add column if not exists attendee_user_id uuid references auth.users(id) on delete set null,
  add column if not exists briefing jsonb,
  add column if not exists notes text,
  add column if not exists sdr_call_id uuid references public.voice_calls(id) on delete set null,
  add column if not exists duration_minutes smallint;

create index if not exists idx_meetings_attendee
  on public.scheduled_meetings(account_id, attendee_user_id, starts_at desc);
create index if not exists idx_meetings_status_starts
  on public.scheduled_meetings(account_id, status, starts_at);

-- 2. calendar_availability
create table if not exists public.calendar_availability (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (user_id, weekday, start_time)
);
create index if not exists idx_availability_account_user
  on public.calendar_availability(account_id, user_id);

alter table public.calendar_availability enable row level security;

drop policy if exists "availability_select_member" on public.calendar_availability;
drop policy if exists "availability_self_or_admin_write" on public.calendar_availability;

create policy "availability_select_member" on public.calendar_availability
  for select to authenticated
  using (public.is_account_member(auth.uid(), account_id));
create policy "availability_self_or_admin_write" on public.calendar_availability
  for all to authenticated
  using (
    auth.uid() = user_id
    or public.has_role(auth.uid(), account_id, 'admin'::public.app_role)
  )
  with check (
    auth.uid() = user_id
    or public.has_role(auth.uid(), account_id, 'admin'::public.app_role)
  );

-- 3. calendar_blocks
create table if not exists public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_blocks_user_range
  on public.calendar_blocks(user_id, starts_at, ends_at);

alter table public.calendar_blocks enable row level security;

drop policy if exists "blocks_select_member" on public.calendar_blocks;
drop policy if exists "blocks_self_or_admin_write" on public.calendar_blocks;

create policy "blocks_select_member" on public.calendar_blocks
  for select to authenticated
  using (public.is_account_member(auth.uid(), account_id));
create policy "blocks_self_or_admin_write" on public.calendar_blocks
  for all to authenticated
  using (
    auth.uid() = user_id
    or public.has_role(auth.uid(), account_id, 'admin'::public.app_role)
  )
  with check (
    auth.uid() = user_id
    or public.has_role(auth.uid(), account_id, 'admin'::public.app_role)
  );

-- 4. RPC: meetings_list
create or replace function public.meetings_list(
  p_account_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'starts_at', m.starts_at,
      'ends_at', m.ends_at,
      'duration_minutes', m.duration_minutes,
      'status', m.status,
      'invitee_name', m.invitee_name,
      'invitee_email', m.invitee_email,
      'invitee_phone', m.invitee_phone,
      'meeting_url', m.meeting_url,
      'attendee_user_id', m.attendee_user_id,
      'attendee_name', (select coalesce(p.display_name, p.name, p.email) from public.profiles p where p.id = m.attendee_user_id),
      'briefing', m.briefing,
      'notes', m.notes,
      'sdr_call_id', m.sdr_call_id,
      'contact_id', m.contact_id,
      'attended_at', m.attended_at,
      'detected_no_show_at', m.detected_no_show_at,
      'cancellation_reason', m.cancellation_reason
    )
    order by m.starts_at
  ), '[]'::jsonb)
  into v_result
  from public.scheduled_meetings m
  where m.account_id = p_account_id
    and m.starts_at >= p_start
    and m.starts_at < p_end;

  return v_result;
end$$;

grant execute on function public.meetings_list(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- 5. RPC: meetings_set_outcome
create or replace function public.meetings_set_outcome(
  p_meeting_id uuid,
  p_status text,
  p_notes text default null,
  p_cancellation_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id
    from public.scheduled_meetings where id = p_meeting_id;
  if v_account_id is null then raise exception 'meeting not found'; end if;

  if not public.is_account_member(auth.uid(), v_account_id) then
    raise exception 'forbidden';
  end if;

  if p_status not in ('scheduled','attended','no_show','rescheduled','canceled') then
    raise exception 'invalid status';
  end if;

  update public.scheduled_meetings
    set status = p_status,
        notes = coalesce(p_notes, notes),
        attended_at = case when p_status = 'attended' then now() else attended_at end,
        detected_no_show_at = case when p_status = 'no_show' then coalesce(detected_no_show_at, now()) else detected_no_show_at end,
        cancellation_reason = coalesce(p_cancellation_reason, cancellation_reason),
        updated_at = now()
    where id = p_meeting_id;
end$$;

grant execute on function public.meetings_set_outcome(uuid, text, text, text) to authenticated, service_role;

-- 6. RPC: availability_get_weekly
create or replace function public.availability_get_weekly(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'user_id', a.user_id,
      'user_name', (select coalesce(p.display_name, p.name, p.email) from public.profiles p where p.id = a.user_id),
      'weekday', a.weekday,
      'start_time', a.start_time::text,
      'end_time', a.end_time::text
    )
    order by a.user_id, a.weekday, a.start_time
  ), '[]'::jsonb)
  into v_result
  from public.calendar_availability a
  where a.account_id = p_account_id;

  return v_result;
end$$;

grant execute on function public.availability_get_weekly(uuid) to authenticated, service_role;

-- 7. RPC: availability_set_weekly
create or replace function public.availability_set_weekly(
  p_account_id uuid,
  p_user_id uuid,
  p_slots jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot jsonb;
begin
  if auth.uid() <> p_user_id and not public.has_role(auth.uid(), p_account_id, 'admin'::public.app_role) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1 from public.account_users
    where account_id = p_account_id and user_id = p_user_id
  ) then
    raise exception 'user not in account';
  end if;

  delete from public.calendar_availability
    where account_id = p_account_id and user_id = p_user_id;

  for v_slot in select jsonb_array_elements(p_slots) loop
    insert into public.calendar_availability(account_id, user_id, weekday, start_time, end_time)
    values (
      p_account_id,
      p_user_id,
      (v_slot->>'weekday')::smallint,
      (v_slot->>'start_time')::time,
      (v_slot->>'end_time')::time
    );
  end loop;
end$$;

grant execute on function public.availability_set_weekly(uuid, uuid, jsonb) to authenticated, service_role;

-- 8. RPC: availability_compute_slots
create or replace function public.availability_compute_slots(
  p_account_id uuid,
  p_days_ahead integer default 14,
  p_duration_minutes integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_horizon timestamptz := now() + (p_days_ahead || ' days')::interval;
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  with day_grid as (
    select generate_series(
      date_trunc('day', v_now),
      date_trunc('day', v_horizon),
      interval '1 day'
    )::date as d
  ),
  slot_grid as (
    select
      a.user_id,
      (g.d::timestamptz + a.start_time::interval) as slot_start_anchor,
      (g.d::timestamptz + a.end_time::interval) as slot_end_anchor
    from public.calendar_availability a
    cross join day_grid g
    where a.account_id = p_account_id
      and extract(dow from g.d)::smallint = a.weekday
  ),
  windows as (
    select
      sg.user_id,
      sg.slot_start_anchor + (offset_min || ' min')::interval as slot_starts_at,
      sg.slot_start_anchor + ((offset_min + p_duration_minutes) || ' min')::interval as slot_ends_at
    from slot_grid sg
    cross join lateral generate_series(
      0,
      (extract(epoch from (sg.slot_end_anchor - sg.slot_start_anchor))/60)::int - p_duration_minutes,
      p_duration_minutes
    ) as offset_min
    where sg.slot_start_anchor + (offset_min || ' min')::interval > v_now
      and sg.slot_start_anchor + ((offset_min + p_duration_minutes) || ' min')::interval <= sg.slot_end_anchor
  ),
  free as (
    select w.user_id, w.slot_starts_at, w.slot_ends_at
    from windows w
    where not exists (
      select 1 from public.calendar_blocks b
      where b.user_id = w.user_id
        and b.starts_at < w.slot_ends_at
        and b.ends_at > w.slot_starts_at
    )
    and not exists (
      select 1 from public.scheduled_meetings m
      where m.account_id = p_account_id
        and m.attendee_user_id = w.user_id
        and m.status in ('scheduled')
        and m.starts_at < w.slot_ends_at
        and (m.ends_at is null or m.ends_at > w.slot_starts_at)
    )
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'user_id', f.user_id,
      'user_name', (select coalesce(p.display_name, p.name, p.email) from public.profiles p where p.id = f.user_id),
      'slot_starts_at', f.slot_starts_at,
      'slot_ends_at', f.slot_ends_at,
      'duration_min', p_duration_minutes
    )
    order by f.slot_starts_at, f.user_id
  ), '[]'::jsonb)
  into v_result
  from free f;

  return v_result;
end$$;

grant execute on function public.availability_compute_slots(uuid, integer, integer) to authenticated, service_role;