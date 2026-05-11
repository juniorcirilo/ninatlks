-- ============================================================
-- Twilio integration — SMS + recordings + transcription + provisioning
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. 'sms' channel_type
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'channel_type' and pg_enum.enumlabel = 'sms'
  ) then
    alter type public.channel_type add value 'sms';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 2. sms_opt_outs — compliance por conta + número de contato
-- ─────────────────────────────────────────────────────────────
-- One row per (account, phone). Insert on STOP/SAIR/CANCELAR; channels-send
-- must consult this before dispatching SMS.
create table if not exists public.sms_opt_outs (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number text not null,        -- E.164
  reason text,
  opted_out_at timestamptz not null default now(),
  opted_back_in_at timestamptz,      -- populated when contact sends START
  unique (account_id, phone_number)
);
create index if not exists idx_sms_opt_outs_account on public.sms_opt_outs(account_id);

alter table public.sms_opt_outs enable row level security;
drop policy if exists "sms_opt_select_member" on public.sms_opt_outs;
create policy "sms_opt_select_member" on public.sms_opt_outs
  for select to authenticated using (is_account_member(auth.uid(), account_id));
-- service role inserts / updates only.

-- ─────────────────────────────────────────────────────────────
-- 3. voice_calls — novas colunas para pipeline de gravação/transcrição
-- ─────────────────────────────────────────────────────────────
alter table public.voice_calls
  add column if not exists recording_sid text,
  add column if not exists recording_storage_path text,
  add column if not exists recording_duration_sec integer,
  add column if not exists transcription_status text default 'idle'
      check (transcription_status in ('idle','pending','processing','done','failed')),
  add column if not exists transcription_provider text,
  add column if not exists transcription_error text,
  add column if not exists transcription_completed_at timestamptz;

create index if not exists idx_voice_calls_recording_sid
  on public.voice_calls(recording_sid)
  where recording_sid is not null;
create index if not exists idx_voice_calls_tx_pending
  on public.voice_calls(account_id, created_at desc)
  where transcription_status in ('pending','processing');

-- ─────────────────────────────────────────────────────────────
-- 4. twilio_number_provisioning — audit trail de compras/ajustes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.twilio_number_provisioning (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  e164 text not null,
  action text not null check (action in ('search','buy','release','configure')),
  request jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  http_status integer,
  triggered_by_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_twilio_prov_account
  on public.twilio_number_provisioning(account_id, created_at desc);

alter table public.twilio_number_provisioning enable row level security;
drop policy if exists "twprov_select_admin" on public.twilio_number_provisioning;
create policy "twprov_select_admin" on public.twilio_number_provisioning
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────
-- 5. phone_numbers.provider_config shape documented
-- ─────────────────────────────────────────────────────────────
comment on column public.phone_numbers.provider_config is
$$Shape for Twilio numbers:
{
  twilio_sid: string,             -- Twilio PN_xxx SID (required after buy)
  capabilities: { voice: bool, sms: bool, mms: bool, fax: bool },
  messaging_service_sid: string,  -- optional MG_xxx when using Messaging Service
  forward_to: string,             -- E.164 for inbound_behavior=forward_to_agent
  voice_url: string,              -- Twilio-set incoming voice webhook
  sms_url: string                 -- Twilio-set incoming SMS webhook
}
SMS uses the same access token logic as voice: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
(global env) OR per-channel config.twilio_account_sid + config.twilio_auth_token.$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Unique source_id dedup — already applied globally; SMS inherits.
-- ─────────────────────────────────────────────────────────────
-- Nothing to add: messages.source_id unique per (account, source_id)
-- exists from the Meta migration and works for Twilio MessageSid the same way.
