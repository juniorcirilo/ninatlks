import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419150000_voice_campaigns.sql.
export class VoiceCampaigns20260419150000 implements MigrationInterface {
  name = 'VoiceCampaigns20260419150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Voice outbound campaigns + escalation rules + ElevenLabs usage tracking
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. voice_campaigns — parent record for outbound voice blasts
-- ─────────────────────────────────────────────────────────────
create table if not exists public.voice_campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  description text,

  -- Target voice / script
  persona_id uuid references public.agent_personas(id) on delete set null,
  voice_id text,                            -- ElevenLabs voice_id override
  language_code text default 'pt-BR',

  -- Script mode
  script_mode text not null default 'conversational'
    check (script_mode in ('script_readback', 'conversational', 'hybrid')),
  -- "script_readback"    IA lê um texto fixo e encerra (menor custo)
  -- "conversational"     conversa livre guiada por system_prompt (voice runtime)
  -- "hybrid"             abre com texto fixo, depois conversacional

  opening_script text,                       -- required if script_mode != conversational
  system_prompt text,                        -- override of persona prompt

  -- Origin phone number (must belong to same account)
  phone_number_id uuid references public.phone_numbers(id) on delete set null,

  -- Escalation
  escalation_rules jsonb not null default '[]'::jsonb,
  -- [{ trigger: "keyword" | "no_response_sec" | "negative_sentiment" | "confidence_below",
  --    value: string | number, action: "transfer" | "voicemail" | "hangup", target: string }]

  max_call_duration_sec integer not null default 300,
  voicemail_detection boolean not null default true,
  record_call boolean not null default true,

  -- Lifecycle
  status text not null default 'draft'
    check (status in ('draft','scheduled','running','paused','completed','failed','canceled')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,

  -- Totals (denormalized for dashboard)
  contact_count integer not null default 0,
  placed_count integer not null default 0,
  connected_count integer not null default 0,
  escalated_count integer not null default 0,
  voicemail_count integer not null default 0,
  failed_count integer not null default 0,

  triggered_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_voice_campaigns_account_status
  on public.voice_campaigns(account_id, status, created_at desc);
`);
    await queryRunner.query(`
create index if not exists idx_voice_campaigns_scheduled
  on public.voice_campaigns(scheduled_for) where status = 'scheduled';
`);
    await queryRunner.query(`
alter table public.voice_campaigns enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "vc_select_member" on public.voice_campaigns;
`);
    await queryRunner.query(`
drop policy if exists "vc_insert_member" on public.voice_campaigns;
`);
    await queryRunner.query(`
drop policy if exists "vc_update_member" on public.voice_campaigns;
`);
    await queryRunner.query(`
drop policy if exists "vc_delete_admin" on public.voice_campaigns;
`);
    await queryRunner.query(`
create policy "vc_select_member" on public.voice_campaigns
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "vc_insert_member" on public.voice_campaigns
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "vc_update_member" on public.voice_campaigns
  for update to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "vc_delete_admin" on public.voice_campaigns
  for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
drop trigger if exists set_voice_campaigns_updated_at on public.voice_campaigns;
`);
    await queryRunner.query(`
create trigger set_voice_campaigns_updated_at
  before update on public.voice_campaigns
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 2. voice_campaign_contacts — per-contact dispatch rows
-- ─────────────────────────────────────────────────────────────
create table if not exists public.voice_campaign_contacts (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.voice_campaigns(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  phone_number text not null,                -- E.164

  status text not null default 'queued'
    check (status in ('queued','placed','ringing','connected','voicemail','escalated','completed','failed','canceled')),
  voice_call_id uuid references public.voice_calls(id) on delete set null,

  -- Per-contact template variables for opening_script substitution
  variables jsonb not null default '{}'::jsonb,

  -- Outcome summary
  outcome text,                              -- 'answered','voicemail','busy','failed','transferred'
  transfer_target text,                      -- E.164 if transferred
  escalation_reason text,
  call_duration_sec integer,
  cost_cents integer,

  -- Scheduling
  dispatch_after timestamptz default now(),
  dispatched_at timestamptz,
  finished_at timestamptz,

  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
`);
    await queryRunner.query(`
create index if not exists idx_vcc_campaign_status
  on public.voice_campaign_contacts(campaign_id, status);
`);
    await queryRunner.query(`
create index if not exists idx_vcc_dispatch_ready
  on public.voice_campaign_contacts(dispatch_after)
  where status = 'queued';
`);
    await queryRunner.query(`
create index if not exists idx_vcc_account_active
  on public.voice_campaign_contacts(account_id, status)
  where status in ('placed','ringing','connected','escalated');
`);
    await queryRunner.query(`
alter table public.voice_campaign_contacts enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "vcc_select_member" on public.voice_campaign_contacts;
`);
    await queryRunner.query(`
drop policy if exists "vcc_insert_member" on public.voice_campaign_contacts;
`);
    await queryRunner.query(`
drop policy if exists "vcc_update_member" on public.voice_campaign_contacts;
`);
    await queryRunner.query(`
create policy "vcc_select_member" on public.voice_campaign_contacts
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "vcc_insert_member" on public.voice_campaign_contacts
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "vcc_update_member" on public.voice_campaign_contacts
  for update to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
drop trigger if exists set_vcc_updated_at on public.voice_campaign_contacts;
`);
    await queryRunner.query(`
create trigger set_vcc_updated_at
  before update on public.voice_campaign_contacts
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 3. escalation_rules — global/account-level rules layered with per-campaign
-- ─────────────────────────────────────────────────────────────
create table if not exists public.escalation_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  scope text not null default 'account'
    check (scope in ('account','channel','inbox','persona','campaign')),
  scope_ref uuid,                            -- references the scoped entity
  priority int not null default 100,          -- lower = evaluated first
  enabled boolean not null default true,

  trigger_type text not null
    check (trigger_type in ('keyword','no_response','negative_sentiment','confidence_below','off_hours','over_limit','explicit_request')),
  trigger_config jsonb not null default '{}'::jsonb,

  action text not null
    check (action in ('transfer_to_human','transfer_to_number','take_voicemail','hang_up','notify_only')),
  action_target text,                         -- E.164 phone, user_id, or inbox_id

  label text,
  description text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_escalation_rules_account_priority
  on public.escalation_rules(account_id, priority) where enabled = true;
`);
    await queryRunner.query(`
alter table public.escalation_rules enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "er_select_member" on public.escalation_rules;
`);
    await queryRunner.query(`
drop policy if exists "er_write_admin" on public.escalation_rules;
`);
    await queryRunner.query(`
create policy "er_select_member" on public.escalation_rules
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "er_write_admin" on public.escalation_rules
  for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
drop trigger if exists set_escalation_rules_updated_at on public.escalation_rules;
`);
    await queryRunner.query(`
create trigger set_escalation_rules_updated_at
  before update on public.escalation_rules
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 4. elevenlabs_usage_log — per-event character usage for billing visibility
-- ─────────────────────────────────────────────────────────────
create table if not exists public.elevenlabs_usage_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  persona_id uuid references public.agent_personas(id) on delete set null,
  voice_id text,
  character_count integer not null,
  model_id text,
  purpose text,                               -- 'voice_runtime','campaign','preview','outbound_dial'
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_el_usage_account_date
  on public.elevenlabs_usage_log(account_id, created_at desc);
`);
    await queryRunner.query(`
alter table public.elevenlabs_usage_log enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "elu_select_admin" on public.elevenlabs_usage_log;
`);
    await queryRunner.query(`
create policy "elu_select_admin" on public.elevenlabs_usage_log
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- service-role inserts only.

-- ─────────────────────────────────────────────────────────────
-- 5. Realtime publications so UI dashboards stay live
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_campaigns'
  ) then
    execute 'alter publication supabase_realtime add table public.voice_campaigns';
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_campaign_contacts'
  ) then
    execute 'alter publication supabase_realtime add table public.voice_campaign_contacts';
  end if;
end $$;
`);
    await queryRunner.query(`
alter table public.voice_campaigns replica identity full;
`);
    await queryRunner.query(`
alter table public.voice_campaign_contacts replica identity full;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 6. RPC to bump campaign totals (avoids races during parallel dispatches)
-- ─────────────────────────────────────────────────────────────
create or replace function public.bump_voice_campaign_totals(
  p_campaign_id uuid,
  p_placed int default 0,
  p_connected int default 0,
  p_escalated int default 0,
  p_voicemail int default 0,
  p_failed int default 0
) returns void
language sql
security definer
set search_path = public
as $$
  update public.voice_campaigns
     set placed_count = placed_count + p_placed,
         connected_count = connected_count + p_connected,
         escalated_count = escalated_count + p_escalated,
         voicemail_count = voicemail_count + p_voicemail,
         failed_count = failed_count + p_failed,
         updated_at = now()
   where id = p_campaign_id;
$$;
`);
    await queryRunner.query(`
grant execute on function public.bump_voice_campaign_totals(uuid, int, int, int, int, int) to authenticated, service_role;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'VoiceCampaigns20260419150000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
