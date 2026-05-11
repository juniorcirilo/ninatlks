-- =============================================================
-- Sprint 2 — Mini-CRM (pipeline + stages) + auto-classification deltas
-- =============================================================
-- Adds:
--   - lead_pipelines (configurable per account; seeded with 1 default)
--   - lead_stages (7 default stages: Novo → ... → Ganhou/Perdeu)
--   - contacts: stage_id, score, source, stage_changed_at, briefing
--   - voice_calls: sentiment, classification (jsonb)
-- Drops debt-collection remnants on voice_calls (debt_id, collection_outcome).

-- 1. Pipelines + stages -----------------------------------------------------
create table if not exists public.lead_pipelines (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name)
);
create unique index if not exists idx_pipelines_one_default
  on public.lead_pipelines(account_id) where is_default = true;

create table if not exists public.lead_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.lead_pipelines(id) on delete cascade,
  name text not null,
  position smallint not null,
  color text not null default 'slate',
  is_won boolean not null default false,
  is_lost boolean not null default false,
  sla_hours smallint,
  created_at timestamptz not null default now(),
  unique (pipeline_id, position)
);
create index if not exists idx_stages_pipeline on public.lead_stages(pipeline_id, position);

alter table public.lead_pipelines enable row level security;
alter table public.lead_stages enable row level security;

drop policy if exists "pipelines_select_member" on public.lead_pipelines;
drop policy if exists "pipelines_admin_write" on public.lead_pipelines;
drop policy if exists "stages_select_member" on public.lead_stages;
drop policy if exists "stages_admin_write" on public.lead_stages;

create policy "pipelines_select_member" on public.lead_pipelines
  for select to authenticated
  using (public.is_account_member(auth.uid(), account_id));
create policy "pipelines_admin_write" on public.lead_pipelines
  for all to authenticated
  using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));

create policy "stages_select_member" on public.lead_stages
  for select to authenticated
  using (
    exists (
      select 1 from public.lead_pipelines p
      where p.id = lead_stages.pipeline_id
        and public.is_account_member(auth.uid(), p.account_id)
    )
  );
create policy "stages_admin_write" on public.lead_stages
  for all to authenticated
  using (
    exists (
      select 1 from public.lead_pipelines p
      where p.id = lead_stages.pipeline_id
        and public.has_role(auth.uid(), p.account_id, 'admin'::public.app_role)
    )
  )
  with check (
    exists (
      select 1 from public.lead_pipelines p
      where p.id = lead_stages.pipeline_id
        and public.has_role(auth.uid(), p.account_id, 'admin'::public.app_role)
    )
  );

-- 2. Helper: seed default pipeline + 7 stages for an account ---------------
create or replace function public.seed_default_pipeline(p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipeline_id uuid;
begin
  select id into v_pipeline_id
    from public.lead_pipelines
    where account_id = p_account_id and is_default = true
    limit 1;

  if v_pipeline_id is not null then
    return v_pipeline_id;
  end if;

  insert into public.lead_pipelines(account_id, name, is_default)
    values (p_account_id, 'Funil padrão', true)
    returning id into v_pipeline_id;

  insert into public.lead_stages(pipeline_id, name, position, color, is_won, is_lost)
  values
    (v_pipeline_id, 'Novo',                1, 'slate',   false, false),
    (v_pipeline_id, 'Contatado',           2, 'sky',     false, false),
    (v_pipeline_id, 'Qualificado',         3, 'violet',  false, false),
    (v_pipeline_id, 'Reunião agendada',    4, 'amber',   false, false),
    (v_pipeline_id, 'Reunião realizada',   5, 'cyan',    false, false),
    (v_pipeline_id, 'Ganhou',              6, 'emerald', true,  false),
    (v_pipeline_id, 'Perdeu',              7, 'rose',    false, true);

  return v_pipeline_id;
end$$;

grant execute on function public.seed_default_pipeline(uuid) to authenticated, service_role;

-- 3. Bootstrap: seed pipeline for every existing account (idempotent) ------
do $$
declare
  v_account record;
begin
  for v_account in select id from public.accounts loop
    perform public.seed_default_pipeline(v_account.id);
  end loop;
end$$;

-- 4. Auto-seed pipeline for new accounts -----------------------------------
create or replace function public.tg_account_seed_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_pipeline(new.id);
  return new;
end$$;

drop trigger if exists trg_account_seed_pipeline on public.accounts;
create trigger trg_account_seed_pipeline
  after insert on public.accounts
  for each row execute function public.tg_account_seed_pipeline();

-- 5. contacts deltas --------------------------------------------------------
alter table public.contacts
  add column if not exists stage_id uuid references public.lead_stages(id) on delete set null,
  add column if not exists score smallint not null default 0
    check (score between 0 and 100),
  add column if not exists source text
    check (source is null or source in ('inbound','outbound','import','manual')),
  add column if not exists stage_changed_at timestamptz,
  add column if not exists briefing jsonb;

create index if not exists idx_contacts_stage on public.contacts(account_id, stage_id);
create index if not exists idx_contacts_score on public.contacts(account_id, score desc) where score > 0;

-- 6. Trigger: stamp stage_changed_at when stage_id changes ------------------
create or replace function public.tg_contact_stage_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.stage_id is not null then
    new.stage_changed_at := now();
  elsif tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  end if;
  return new;
end$$;

drop trigger if exists trg_contact_stage_change on public.contacts;
create trigger trg_contact_stage_change
  before insert or update of stage_id on public.contacts
  for each row execute function public.tg_contact_stage_change();

-- 7. voice_calls deltas: drop cobrança, add SDR fields ---------------------
-- Drop debt-collection columns (no-op if already dropped via cascade)
alter table public.voice_calls drop column if exists debt_id;
alter table public.voice_calls drop column if exists collection_outcome;

-- Drop the cobrança enum if no other dependents
drop type if exists public.collection_outcome cascade;

-- Add SDR-flavored columns
alter table public.voice_calls
  add column if not exists sentiment jsonb,
  add column if not exists classification jsonb;
-- Note: existing outcome_category / outcome_summary / outcome_confidence /
-- outcome_classified_at columns are reused as-is for SDR outcomes (semantic
-- only; values are now 'qualified','scheduled','not_interested','callback',
-- 'no_answer','voicemail','wrong_number' instead of cobrança ones).

-- 8. RPC: fetch pipeline with leads grouped by stage -----------------------
create or replace function public.pipeline_get(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pipeline_id uuid;
  v_result jsonb;
begin
  if not public.is_account_member(auth.uid(), p_account_id) then
    raise exception 'forbidden';
  end if;

  select id into v_pipeline_id
    from public.lead_pipelines
    where account_id = p_account_id and is_default = true
    limit 1;

  if v_pipeline_id is null then
    v_pipeline_id := public.seed_default_pipeline(p_account_id);
  end if;

  select jsonb_build_object(
    'pipeline_id', v_pipeline_id,
    'stages', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'position', s.position,
            'color', s.color,
            'is_won', s.is_won,
            'is_lost', s.is_lost,
            'leads', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'phone_number', c.phone_number,
                  'email', c.email,
                  'score', c.score,
                  'source', c.source,
                  'stage_changed_at', c.stage_changed_at,
                  'last_activity_at', c.last_activity_at,
                  'briefing', c.briefing
                )
                order by c.score desc, c.stage_changed_at desc nulls last
              )
              from public.contacts c
              where c.account_id = p_account_id
                and c.stage_id = s.id
                and not c.blocked
            ), '[]'::jsonb)
          )
          order by s.position
        )
        from public.lead_stages s
        where s.pipeline_id = v_pipeline_id
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end$$;

grant execute on function public.pipeline_get(uuid) to authenticated, service_role;

-- 9. RPC: move a lead to a stage manually -----------------------------------
create or replace function public.lead_move_to_stage(p_contact_id uuid, p_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_stage_account_id uuid;
begin
  select account_id into v_account_id from public.contacts where id = p_contact_id;
  if v_account_id is null then raise exception 'contact not found'; end if;

  if not public.is_account_member(auth.uid(), v_account_id) then
    raise exception 'forbidden';
  end if;

  select p.account_id into v_stage_account_id
    from public.lead_stages s
    join public.lead_pipelines p on p.id = s.pipeline_id
    where s.id = p_stage_id;
  if v_stage_account_id is null or v_stage_account_id <> v_account_id then
    raise exception 'stage does not belong to this account';
  end if;

  update public.contacts set stage_id = p_stage_id where id = p_contact_id;
end$$;

grant execute on function public.lead_move_to_stage(uuid, uuid) to authenticated, service_role;
