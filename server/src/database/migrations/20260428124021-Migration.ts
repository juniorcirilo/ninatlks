import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260428124021_7c591a78-de34-405b-ab3b-5a259355be55.sql.
export class Migration20260428124021 implements MigrationInterface {
  name = 'Migration20260428124021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- =============================================================
-- Sprint 4 — Lembrete T-15 + retry no-show + cadências de follow-up
-- =============================================================

-- 1. scheduled_meetings deltas
alter table public.scheduled_meetings
  add column if not exists reminder_call_id uuid references public.voice_calls(id) on delete set null,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists reschedule_call_id uuid references public.voice_calls(id) on delete set null,
  add column if not exists retry_count smallint not null default 0,
  add column if not exists max_retries smallint not null default 2;
`);
    await queryRunner.query(`
create index if not exists idx_meetings_reminder_pending
  on public.scheduled_meetings(account_id, starts_at)
  where status = 'scheduled' and reminder_sent_at is null;
`);
    await queryRunner.query(`
create index if not exists idx_meetings_noshow_pending
  on public.scheduled_meetings(account_id, starts_at)
  where status = 'scheduled' and attended_at is null and detected_no_show_at is null;
`);
    await queryRunner.query(`
-- 2. follow_up_cadences
create table if not exists public.follow_up_cadences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  description text,
  trigger_stage_id uuid references public.lead_stages(id) on delete set null,
  trigger_event text not null
    check (trigger_event in ('stage_change','manual','no_show','meeting_attended')),
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name)
);
`);
    await queryRunner.query(`
alter table public.follow_up_cadences enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "cadences_select_member" on public.follow_up_cadences;
`);
    await queryRunner.query(`
drop policy if exists "cadences_admin_write" on public.follow_up_cadences;
`);
    await queryRunner.query(`
create policy "cadences_select_member" on public.follow_up_cadences
  for select to authenticated
  using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "cadences_admin_write" on public.follow_up_cadences
  for all to authenticated
  using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
-- 3. follow_up_executions
create table if not exists public.follow_up_executions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  cadence_id uuid not null references public.follow_up_cadences(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  current_step smallint not null default 0,
  status text not null default 'pending'
    check (status in ('pending','running','completed','canceled','failed')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_followup_due
  on public.follow_up_executions(account_id, status, next_run_at)
  where status = 'pending';
`);
    await queryRunner.query(`
create index if not exists idx_followup_contact
  on public.follow_up_executions(contact_id, cadence_id);
`);
    await queryRunner.query(`
alter table public.follow_up_executions enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "followups_select_member" on public.follow_up_executions;
`);
    await queryRunner.query(`
drop policy if exists "followups_admin_write" on public.follow_up_executions;
`);
    await queryRunner.query(`
create policy "followups_select_member" on public.follow_up_executions
  for select to authenticated
  using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "followups_admin_write" on public.follow_up_executions
  for all to authenticated
  using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
-- 4. RPC: meeting_reminder_due
create or replace function public.meeting_reminder_due(p_limit integer default 50)
returns table (
  id uuid, account_id uuid, contact_id uuid, starts_at timestamptz,
  invitee_phone text, invitee_name text
)
language sql stable security definer set search_path = public
as $$
  select m.id, m.account_id, m.contact_id, m.starts_at, m.invitee_phone, m.invitee_name
  from public.scheduled_meetings m
  where m.status = 'scheduled'
    and m.reminder_sent_at is null
    and m.starts_at between now() + interval '14 minutes' and now() + interval '16 minutes'
    and m.invitee_phone is not null
  order by m.starts_at
  limit p_limit;
$$;
`);
    await queryRunner.query(`
grant execute on function public.meeting_reminder_due(integer) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 5. RPC: meeting_noshow_due
create or replace function public.meeting_noshow_due(p_limit integer default 50)
returns table (
  id uuid, account_id uuid, contact_id uuid, starts_at timestamptz,
  retry_count smallint, max_retries smallint, invitee_phone text, invitee_name text
)
language sql stable security definer set search_path = public
as $$
  select m.id, m.account_id, m.contact_id, m.starts_at,
         m.retry_count, m.max_retries, m.invitee_phone, m.invitee_name
  from public.scheduled_meetings m
  where m.status = 'scheduled'
    and m.attended_at is null
    and m.detected_no_show_at is null
    and m.starts_at < now() - interval '10 minutes'
    and m.retry_count < m.max_retries
    and m.invitee_phone is not null
  order by m.starts_at
  limit p_limit;
$$;
`);
    await queryRunner.query(`
grant execute on function public.meeting_noshow_due(integer) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 6. RPC: cadence_due
create or replace function public.cadence_due(p_limit integer default 50)
returns table (
  execution_id uuid, account_id uuid, cadence_id uuid, contact_id uuid,
  current_step smallint, step_definition jsonb
)
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  with due as (
    select e.id as exec_id, e.account_id, e.cadence_id, e.contact_id, e.current_step
    from public.follow_up_executions e
    where e.status = 'pending'
      and (e.next_run_at is null or e.next_run_at <= now())
    order by e.next_run_at nulls first
    limit p_limit
  )
  select d.exec_id, d.account_id, d.cadence_id, d.contact_id, d.current_step,
    coalesce((c.steps -> d.current_step), 'null'::jsonb) as step_definition
  from due d
  join public.follow_up_cadences c on c.id = d.cadence_id and c.enabled = true;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.cadence_due(integer) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 7. RPC: cadence_advance
create or replace function public.cadence_advance(
  p_execution_id uuid, p_success boolean, p_error text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_exec public.follow_up_executions;
  v_cadence public.follow_up_cadences;
  v_next_step smallint;
  v_next_step_def jsonb;
  v_offset_hours numeric;
begin
  select * into v_exec from public.follow_up_executions where id = p_execution_id for update;
  if not found then raise exception 'execution not found'; end if;

  select * into v_cadence from public.follow_up_cadences where id = v_exec.cadence_id;
  if not found then raise exception 'cadence not found'; end if;

  v_next_step := v_exec.current_step + 1;
  v_next_step_def := v_cadence.steps -> v_next_step;

  if v_next_step_def is null then
    update public.follow_up_executions
      set status = case when p_success then 'completed' else 'failed' end,
          last_run_at = now(), last_error = p_error, updated_at = now()
      where id = p_execution_id;
    return;
  end if;

  v_offset_hours := coalesce((v_next_step_def->>'offset_hours')::numeric, 0);

  update public.follow_up_executions
    set current_step = v_next_step,
        next_run_at = now() + (v_offset_hours || ' hours')::interval,
        last_run_at = now(), last_error = p_error, updated_at = now(), status = 'pending'
    where id = p_execution_id;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.cadence_advance(uuid, boolean, text) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 8. RPC: cadence_enroll_contact
create or replace function public.cadence_enroll_contact(
  p_cadence_id uuid, p_contact_id uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_cadence public.follow_up_cadences;
  v_first_step jsonb;
  v_first_offset numeric;
  v_exec_id uuid;
begin
  select * into v_cadence from public.follow_up_cadences where id = p_cadence_id;
  if not found then raise exception 'cadence not found'; end if;

  if not public.is_account_member(auth.uid(), v_cadence.account_id) then
    raise exception 'forbidden';
  end if;

  v_first_step := v_cadence.steps -> 0;
  v_first_offset := coalesce((v_first_step->>'offset_hours')::numeric, 0);

  insert into public.follow_up_executions(
    account_id, cadence_id, contact_id, current_step, status, next_run_at
  ) values (
    v_cadence.account_id, p_cadence_id, p_contact_id, 0, 'pending',
    now() + (v_first_offset || ' hours')::interval
  )
  returning id into v_exec_id;

  return v_exec_id;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.cadence_enroll_contact(uuid, uuid) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 9. RPC: followup_list_cadences
create or replace function public.followup_list_cadences(p_account_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'name', c.name, 'description', c.description,
      'trigger_event', c.trigger_event, 'trigger_stage_id', c.trigger_stage_id,
      'enabled', c.enabled, 'steps', c.steps,
      'pending_count', (select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'pending'),
      'completed_count', (select count(*) from public.follow_up_executions e
        where e.cadence_id = c.id and e.status = 'completed')
    )
    order by c.created_at desc
  ), '[]'::jsonb)
  into v_result
  from public.follow_up_cadences c
  where c.account_id = p_account_id;

  return v_result;
end$$;
`);
    await queryRunner.query(`
grant execute on function public.followup_list_cadences(uuid) to authenticated, service_role;
`);
    await queryRunner.query(`
-- 10. Schedule crons
select public.schedule_edge_cron(
  'nexus-meeting-reminder-tick', '* * * * *', 'meeting-reminder-tick', '{}'::jsonb
);
`);
    await queryRunner.query(`
select public.schedule_edge_cron(
  'nexus-meeting-noshow-tick', '*/5 * * * *', 'meeting-noshow-tick', '{}'::jsonb
);
`);
    await queryRunner.query(`
select public.schedule_edge_cron(
  'nexus-cadence-tick', '*/5 * * * *', 'cadence-tick', '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260428124021 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
