import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420100000_workflow_engine.sql.
export class WorkflowEngine20260420100000 implements MigrationInterface {
  name = 'WorkflowEngine20260420100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Workflow engine — the orchestration layer that connects triggers to actions
-- ============================================================
-- Core idea: a \`workflow\` is a reusable definition saying "when THIS happens,
-- if THESE conditions hold, do THESE actions". The executor runs them one
-- \`workflow_run\` at a time. Every run is observable in audit_log + the
-- workflow_runs table so ops can debug silent failures.

-- ─────────────────────────────────────────────────────────────
-- 1. workflows — the definitions
-- ─────────────────────────────────────────────────────────────
-- \`trigger\` jsonb shape:
--   {
--     "type": "webhook.inbound" | "cron.schedule" | "outcome.created"
--           | "conversation.resolved" | "contact.tag_added",
--     "config": { ... kind-specific }
--   }
--
-- \`conditions\` jsonb shape: array, ALL must be truthy (AND semantics).
--   [
--     { "path": "event.payload.payment.amount", "op": "gte", "value": 100 },
--     { "path": "contact.timezone", "op": "eq", "value": "America/Sao_Paulo" }
--   ]
--
-- \`actions\` jsonb shape: ordered array, executed sequentially.
--   [
--     { "type": "voice.start_campaign", "params": {...} },
--     { "type": "message.send_template", "params": {...} },
--     { "type": "task.create", "params": {...} }
--   ]

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  description text,
  enabled boolean not null default true,

  trigger jsonb not null,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,

  -- Cached hashes so we can quickly match incoming events without opening all rows.
  trigger_type text generated always as (trigger->>'type') stored,

  -- Useful stats shown in the builder UI.
  last_run_at timestamptz,
  last_run_status text,
  run_count integer not null default 0,
  success_count integer not null default 0,

  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_workflows_account_trigger
  on public.workflows(account_id, trigger_type) where enabled = true;
`);
    await queryRunner.query(`
alter table public.workflows enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "wf_select_member" on public.workflows;
`);
    await queryRunner.query(`
drop policy if exists "wf_insert_member" on public.workflows;
`);
    await queryRunner.query(`
drop policy if exists "wf_update_member" on public.workflows;
`);
    await queryRunner.query(`
drop policy if exists "wf_delete_admin" on public.workflows;
`);
    await queryRunner.query(`
create policy "wf_select_member" on public.workflows
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "wf_insert_member" on public.workflows
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "wf_update_member" on public.workflows
  for update to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "wf_delete_admin" on public.workflows
  for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
drop trigger if exists set_workflows_updated_at on public.workflows;
`);
    await queryRunner.query(`
create trigger set_workflows_updated_at
  before update on public.workflows
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 2. workflow_runs — one per execution
-- ─────────────────────────────────────────────────────────────
create table if not exists public.workflow_runs (
  id bigint generated always as identity primary key,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,

  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','canceled','skipped')),
  trigger_event jsonb not null default '{}'::jsonb,
  conditions_outcome jsonb not null default '[]'::jsonb,   -- trace of which conditions passed
  action_results jsonb not null default '[]'::jsonb,       -- trace of each action's output
  error text,

  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  correlation_id text,

  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_workflow_runs_workflow
  on public.workflow_runs(workflow_id, created_at desc);
`);
    await queryRunner.query(`
create index if not exists idx_workflow_runs_account_status
  on public.workflow_runs(account_id, status, created_at desc);
`);
    await queryRunner.query(`
create index if not exists idx_workflow_runs_pending
  on public.workflow_runs(created_at)
  where status in ('pending','running');
`);
    await queryRunner.query(`
alter table public.workflow_runs enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "wr_select_member" on public.workflow_runs;
`);
    await queryRunner.query(`
create policy "wr_select_member" on public.workflow_runs
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- inserts/updates only via service_role (executor writes them).

-- ─────────────────────────────────────────────────────────────
-- 3. workflow_events — inbound events before they're matched to workflows
-- ─────────────────────────────────────────────────────────────
-- Think of this as the "inbox" of external triggers. The generic webhook
-- endpoint drops events here and the executor picks them up to find any
-- workflows that match.
create table if not exists public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,

  source text not null,              -- 'calendar' | 'billing' | 'form' | 'pipedrive' | 'hubspot' | 'generic'
  provider text,                     -- 'calendly' | 'google' | 'asaas' | 'stripe' | 'typeform' | ...
  event_type text not null,          -- 'meeting_no_show' | 'payment_overdue' | 'form_submitted' | ...
  payload jsonb not null default '{}'::jsonb,
  dedup_key text,                    -- caller-provided idempotency key

  matched_workflow_count integer,
  processed_at timestamptz,
  error text,

  received_at timestamptz not null default now(),
  unique (account_id, source, dedup_key)
);
`);
    await queryRunner.query(`
alter table public.workflow_events
  add column if not exists provider text,
  add column if not exists dedup_key text,
  add column if not exists error text,
  add column if not exists received_at timestamptz not null default now();
`);
    await queryRunner.query(`
create index if not exists idx_workflow_events_unprocessed
  on public.workflow_events(account_id, received_at)
  where processed_at is null;
`);
    await queryRunner.query(`
alter table public.workflow_events enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "we_select_admin" on public.workflow_events;
`);
    await queryRunner.query(`
create policy "we_select_admin" on public.workflow_events
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- writes via service_role only.

-- ─────────────────────────────────────────────────────────────
-- 4. workflow_tags & contact_tags — simple tagging so \`contact.tag_added\`
--    trigger has a data model behind it.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.contact_tags (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag text not null,
  added_by uuid,
  created_at timestamptz not null default now(),
  unique (account_id, contact_id, tag)
);
`);
    await queryRunner.query(`
create index if not exists idx_contact_tags_lookup
  on public.contact_tags(account_id, tag);
`);
    await queryRunner.query(`
create index if not exists idx_contact_tags_contact
  on public.contact_tags(contact_id);
`);
    await queryRunner.query(`
alter table public.contact_tags enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "ct_select_member" on public.contact_tags;
`);
    await queryRunner.query(`
drop policy if exists "ct_insert_member" on public.contact_tags;
`);
    await queryRunner.query(`
drop policy if exists "ct_delete_member" on public.contact_tags;
`);
    await queryRunner.query(`
create policy "ct_select_member" on public.contact_tags
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "ct_insert_member" on public.contact_tags
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "ct_delete_member" on public.contact_tags
  for delete to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 5. Realtime so the builder UI can show status live
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_runs'
  ) then
    execute 'alter publication supabase_realtime add table public.workflow_runs';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflows'
  ) then
    execute 'alter publication supabase_realtime add table public.workflows';
  end if;
end $$;
`);
    await queryRunner.query(`
alter table public.workflow_runs replica identity full;
`);
    await queryRunner.query(`
alter table public.workflows replica identity full;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 6. RPC helpers — used by the executor to bump counters atomically
-- ─────────────────────────────────────────────────────────────
alter table public.workflows
  add column if not exists trigger jsonb not null default '{}'::jsonb,
  add column if not exists last_run_status text,
  add column if not exists run_count integer not null default 0;
`);
    await queryRunner.query(`
create or replace function public.bump_workflow_counters(
  p_workflow_id uuid,
  p_status text,
  p_finished_at timestamptz default now()
) returns void
language sql
security definer
set search_path = public
as $$
  update public.workflows
     set run_count = run_count + 1,
         success_count = success_count + (case when p_status = 'completed' then 1 else 0 end),
         last_run_at = p_finished_at,
         last_run_status = p_status,
         updated_at = now()
   where id = p_workflow_id;
$$;
`);
    await queryRunner.query(`
grant execute on function public.bump_workflow_counters(uuid, text, timestamptz) to service_role;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 7. DB trigger bridges — emit internal events when common tables change
-- ─────────────────────────────────────────────────────────────
-- When an outcome is created we want workflows with trigger.type='outcome.created'
-- to fire. Instead of making the executor scan outcomes on a cron, we use a
-- thin trigger that inserts an entry in workflow_events with the outcome data.
create or replace function public.tg_outcome_into_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workflow_events (
    account_id, source, event_type, payload
  ) values (
    new.account_id,
    'internal',
    'outcome.created',
    jsonb_build_object(
      'outcome_id', new.id,
      'conversation_id', new.conversation_id,
      'contact_id', new.contact_id,
      'outcome_type', new.outcome_type,
      'value', new.value,
      'currency', new.currency,
      'source', new.source
    )
  );
  return new;
end;
$$;
`);
    await queryRunner.query(`
drop trigger if exists trg_outcome_workflow_event on public.conversation_outcomes;
`);
    await queryRunner.query(`
create trigger trg_outcome_workflow_event
  after insert on public.conversation_outcomes
  for each row execute function public.tg_outcome_into_workflow_events();
`);
    await queryRunner.query(`
-- Similar: conversation.resolved (status=1)
create or replace function public.tg_conv_resolved_into_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 1 and (old.status is distinct from 1) then
    insert into public.workflow_events (
      account_id, source, event_type, payload
    ) values (
      new.account_id,
      'internal',
      'conversation.resolved',
      jsonb_build_object(
        'conversation_id', new.id,
        'contact_id', new.contact_id,
        'inbox_id', new.inbox_id,
        'priority', new.priority,
        'resolved_at', now()
      )
    );
  end if;
  return new;
end;
$$;
`);
    await queryRunner.query(`
drop trigger if exists trg_conv_resolved_workflow_event on public.conversations;
`);
    await queryRunner.query(`
create trigger trg_conv_resolved_workflow_event
  after update on public.conversations
  for each row execute function public.tg_conv_resolved_into_workflow_events();
`);
    await queryRunner.query(`
alter table public.contact_tags
  add column if not exists added_by uuid;
`);
    await queryRunner.query(`
-- contact.tag_added
create or replace function public.tg_tag_added_into_workflow_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workflow_events (
    account_id, source, event_type, payload
  ) values (
    new.account_id,
    'internal',
    'contact.tag_added',
    jsonb_build_object(
      'contact_id', new.contact_id,
      'tag', new.tag,
      'added_by', new.added_by
    )
  );
  return new;
end;
$$;
`);
    await queryRunner.query(`
drop trigger if exists trg_tag_workflow_event on public.contact_tags;
`);
    await queryRunner.query(`
create trigger trg_tag_workflow_event
  after insert on public.contact_tags
  for each row execute function public.tg_tag_added_into_workflow_events();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'WorkflowEngine20260420100000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
