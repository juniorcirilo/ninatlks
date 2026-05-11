-- ============================================================
-- Phase 2 — Voice compliance (BR-focused: LGPD + Lei do Superendividamento
-- + Código de Defesa do Consumidor / Não Perturbe-style controls)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. dnc_list — Do Not Call, per account. A contact in here is never
--    dialed by any voice campaign.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.dnc_list (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number text not null,                    -- E.164
  reason text,                                   -- 'customer_request' | 'stop_reply' | 'regulator_list' | 'manual'
  added_by uuid,
  source text,                                   -- e.g. 'procon_list_2026_04'
  notes text,
  created_at timestamptz not null default now(),
  unique (account_id, phone_number)
);
create index if not exists idx_dnc_account on public.dnc_list(account_id);

alter table public.dnc_list enable row level security;

drop policy if exists "dnc_select_member" on public.dnc_list;
drop policy if exists "dnc_insert_member" on public.dnc_list;
drop policy if exists "dnc_delete_admin" on public.dnc_list;

create policy "dnc_select_member" on public.dnc_list
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "dnc_insert_member" on public.dnc_list
  for insert to authenticated with check (is_account_member(auth.uid(), account_id));
create policy "dnc_delete_admin" on public.dnc_list
  for delete to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────
-- 2. contacts.timezone — IANA timezone string used for "allowed hours"
--    calculation. Defaults to America/Sao_Paulo for BR; overridable.
-- ─────────────────────────────────────────────────────────────
alter table public.contacts
  add column if not exists timezone text default 'America/Sao_Paulo';

-- ─────────────────────────────────────────────────────────────
-- 3. call_attempts_log — per-contact attempt counter so we can enforce
--    "max N attempts per day" without scanning voice_calls history.
--    Used by voice-campaign-dispatch pre-flight.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.call_attempts_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  phone_number text not null,
  campaign_id uuid,
  voice_call_id uuid,
  attempt_at timestamptz not null default now(),
  outcome text                                    -- 'placed'|'no_answer'|'busy'|'failed'|'voicemail'|'answered'|'blocked_dnc'|'blocked_hours'|'blocked_rate_limit'
);

create index if not exists idx_attempts_account_phone_date
  on public.call_attempts_log(account_id, phone_number, attempt_at desc);
create index if not exists idx_attempts_account_date
  on public.call_attempts_log(account_id, attempt_at desc);

alter table public.call_attempts_log enable row level security;

drop policy if exists "cal_select_admin" on public.call_attempts_log;
create policy "cal_select_admin" on public.call_attempts_log
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
-- service role inserts only.

-- ─────────────────────────────────────────────────────────────
-- 4. accounts.internal_attributes extends — default compliance policy
--    per account. Voice campaigns override via campaign.allowed_hours.
-- ─────────────────────────────────────────────────────────────
comment on column public.accounts.internal_attributes is
$$Stores per-account configuration not worth its own column. Known keys:
- webhookSecret (string): HMAC secret for outcome-webhook
- messages_retention_days (int): message retention override
- daily_campaign_limit (int): SMS/WA campaign per-day cap
- compliance: {
    allowed_hours_local: { mon:[9,20], tue:[9,20], ..., sat:[9,14], sun:null },
    max_attempts_per_day_per_contact: 2,
    min_minutes_between_attempts: 120,
    recording_disclaimer: "Esta ligação está sendo gravada para fins de qualidade e auditoria. Ao permanecer na chamada, você concorda com a gravação.",
    disclaimer_voice_id: null                 -- optional ElevenLabs voice override for disclaimer
  }
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. voice_campaigns extensions — campaign-level overrides
-- ─────────────────────────────────────────────────────────────
alter table public.voice_campaigns
  add column if not exists allowed_hours_local jsonb,           -- {mon:[9,20], ...} or null=inherit account
  add column if not exists max_attempts_per_day integer,
  add column if not exists min_minutes_between_attempts integer,
  add column if not exists disclaimer_enabled boolean default true;

-- ─────────────────────────────────────────────────────────────
-- 6. is_phone_allowed_to_call — consolidated check used by dispatcher.
--    Returns { allowed, reason? } so the caller knows whether to skip,
--    delay, or proceed.
-- ─────────────────────────────────────────────────────────────
create or replace function public.is_phone_allowed_to_call(
  p_account_id uuid,
  p_phone_number text,
  p_timezone text default 'America/Sao_Paulo',
  p_allowed_hours_local jsonb default null,
  p_max_attempts_per_day integer default 2,
  p_min_minutes_between_attempts integer default 120
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now_local timestamptz := (now() at time zone p_timezone);
  v_dow text := lower(to_char(v_now_local, 'dy'));   -- mon/tue/wed/thu/fri/sat/sun
  v_hour int := extract(hour from v_now_local);
  v_hours_range jsonb;
  v_start int;
  v_end int;
  v_attempts_today int;
  v_last_attempt_at timestamptz;
  v_dnc_hit int;
begin
  -- DNC check
  select count(*) into v_dnc_hit
    from public.dnc_list
   where account_id = p_account_id and phone_number = p_phone_number;
  if v_dnc_hit > 0 then
    return jsonb_build_object('allowed', false, 'reason', 'dnc');
  end if;

  -- Allowed hours (if provided) — per weekday ranges [start_hour, end_hour)
  if p_allowed_hours_local is not null then
    v_hours_range := p_allowed_hours_local -> v_dow;
    if v_hours_range is null or jsonb_typeof(v_hours_range) = 'null' then
      return jsonb_build_object('allowed', false, 'reason', 'outside_allowed_day');
    end if;
    v_start := (v_hours_range -> 0)::int;
    v_end := (v_hours_range -> 1)::int;
    if v_hour < v_start or v_hour >= v_end then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'outside_allowed_hours',
        'allowed_range', v_hours_range,
        'now_hour_local', v_hour
      );
    end if;
  end if;

  -- Rate limit per day (UTC day — practical approximation)
  select count(*), max(attempt_at) into v_attempts_today, v_last_attempt_at
    from public.call_attempts_log
   where account_id = p_account_id
     and phone_number = p_phone_number
     and attempt_at >= date_trunc('day', now());
  if v_attempts_today >= p_max_attempts_per_day then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'max_attempts_today',
      'attempts', v_attempts_today,
      'cap', p_max_attempts_per_day
    );
  end if;

  -- Min minutes between attempts
  if v_last_attempt_at is not null
     and (extract(epoch from (now() - v_last_attempt_at)) / 60) < p_min_minutes_between_attempts then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'too_soon',
      'last_attempt_at', v_last_attempt_at,
      'min_gap_minutes', p_min_minutes_between_attempts
    );
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.is_phone_allowed_to_call(uuid, text, text, jsonb, integer, integer) from public;
grant execute on function public.is_phone_allowed_to_call(uuid, text, text, jsonb, integer, integer) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 7. Trigger: when an inbound SMS says STOP, auto-insert into dnc_list
--    (sms_opt_outs already exists; we mirror a row into dnc_list since
--    voice campaigns dispatcher looks only at dnc_list).
-- ─────────────────────────────────────────────────────────────
create or replace function public.tg_sms_optout_to_dnc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  for each row
  when (new.opted_back_in_at is null)
  execute function public.tg_sms_optout_to_dnc();
