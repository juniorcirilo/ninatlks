import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424181020_7e9ed261-b6e2-443e-bf6c-71d7d81a56e0.sql.
export class Migration20260424181020 implements MigrationInterface {
  name = 'Migration20260424181020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Cobra · schema de cobrança por voz (ajustada para schema existente)
-- ============================================================

-- ENUMS
create type public.doc_type as enum ('cpf', 'cnpj');
`);
    await queryRunner.query(`
create type public.debt_status as enum (
  'aberto','em_negociacao','acordado','pago','baixado','cancelado'
);
`);
    await queryRunner.query(`
create type public.arrangement_status as enum (
  'pendente','pago','atrasado','cancelado'
);
`);
    await queryRunner.query(`
create type public.collection_outcome as enum (
  'cpc','cpct','nao_atende','caixa_postal','numero_errado',
  'recusa','dnc_solicitado','acordo','pago','sem_resultado'
);
`);
    await queryRunner.query(`
create type public.delivery_channel as enum ('whatsapp','email','sms');
`);
    await queryRunner.query(`
create type public.delivery_status as enum (
  'pendente','enviado','entregue','lido','falhou'
);
`);
    await queryRunner.query(`
-- 1. debtor_profiles
create table public.debtor_profiles (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  doc_type public.doc_type,
  doc_number text,
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create unique index idx_debtor_profiles_account_doc
  on public.debtor_profiles(account_id, doc_number)
  where doc_number is not null;
`);
    await queryRunner.query(`
create index idx_debtor_profiles_account on public.debtor_profiles(account_id);
`);
    await queryRunner.query(`
alter table public.debtor_profiles enable row level security;
`);
    await queryRunner.query(`
create policy "debtor_profiles_select_member" on public.debtor_profiles
  for select to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debtor_profiles_insert_member" on public.debtor_profiles
  for insert to authenticated with check (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debtor_profiles_update_member" on public.debtor_profiles
  for update to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debtor_profiles_delete_admin" on public.debtor_profiles
  for delete to authenticated using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
create trigger tg_debtor_profiles_updated_at
  before update on public.debtor_profiles
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 2. debts
create table public.debts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  external_ref text,
  descricao text,
  valor_original numeric(14,2) not null check (valor_original >= 0),
  valor_atual numeric(14,2) not null check (valor_atual >= 0),
  vencimento date not null,
  origem text,
  status public.debt_status not null default 'aberto',
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  last_call_at timestamptz,
  attempts_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index idx_debts_account_status on public.debts(account_id, status, vencimento);
`);
    await queryRunner.query(`
create index idx_debts_contact on public.debts(contact_id);
`);
    await queryRunner.query(`
create index idx_debts_vencimento on public.debts(vencimento) where status = 'aberto';
`);
    await queryRunner.query(`
alter table public.debts enable row level security;
`);
    await queryRunner.query(`
create policy "debts_select_member" on public.debts
  for select to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debts_insert_member" on public.debts
  for insert to authenticated with check (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debts_update_member" on public.debts
  for update to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "debts_delete_admin" on public.debts
  for delete to authenticated using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
create trigger tg_debts_updated_at
  before update on public.debts
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 3. payment_arrangements
create table public.payment_arrangements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  voice_call_id uuid references public.voice_calls(id) on delete set null,
  valor_negociado numeric(14,2) not null check (valor_negociado >= 0),
  metodo text not null default 'pix' check (metodo in ('pix','boleto','cartao','parcelado')),
  num_parcelas integer not null default 1 check (num_parcelas >= 1),
  primeiro_vencimento date not null,
  asaas_charge_id text,
  asaas_payment_url text,
  status public.arrangement_status not null default 'pendente',
  paid_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index idx_arrangements_account_status
  on public.payment_arrangements(account_id, status, created_at desc);
`);
    await queryRunner.query(`
create index idx_arrangements_debt on public.payment_arrangements(debt_id);
`);
    await queryRunner.query(`
create index idx_arrangements_asaas on public.payment_arrangements(asaas_charge_id)
  where asaas_charge_id is not null;
`);
    await queryRunner.query(`
alter table public.payment_arrangements enable row level security;
`);
    await queryRunner.query(`
create policy "arr_select_member" on public.payment_arrangements
  for select to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "arr_insert_member" on public.payment_arrangements
  for insert to authenticated with check (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "arr_update_member" on public.payment_arrangements
  for update to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "arr_delete_admin" on public.payment_arrangements
  for delete to authenticated using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
create trigger tg_arrangements_updated_at
  before update on public.payment_arrangements
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 4. proposal_deliveries
create table public.proposal_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  arrangement_id uuid not null references public.payment_arrangements(id) on delete cascade,
  channel public.delivery_channel not null,
  recipient text not null,
  status public.delivery_status not null default 'pendente',
  provider_msg_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index idx_proposal_deliveries_arr on public.proposal_deliveries(arrangement_id);
`);
    await queryRunner.query(`
create index idx_proposal_deliveries_account_status
  on public.proposal_deliveries(account_id, status, created_at desc);
`);
    await queryRunner.query(`
alter table public.proposal_deliveries enable row level security;
`);
    await queryRunner.query(`
create policy "pd_select_member" on public.proposal_deliveries
  for select to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "pd_insert_member" on public.proposal_deliveries
  for insert to authenticated with check (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "pd_update_member" on public.proposal_deliveries
  for update to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create trigger tg_proposal_deliveries_updated_at
  before update on public.proposal_deliveries
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 5. dnc_list — estender tabela existente (não recriar)
alter table public.dnc_list
  add column if not exists registered_at timestamptz not null default now();
`);
    await queryRunner.query(`
alter table public.dnc_list
  add column if not exists registered_by uuid references auth.users(id) on delete set null;
`);
    await queryRunner.query(`
alter table public.dnc_list
  add column if not exists metadata jsonb not null default '{}'::jsonb;
`);
    await queryRunner.query(`
-- phone_e164 como coluna gerada (alias do phone_number) p/ compat com edge functions novas
alter table public.dnc_list
  add column if not exists phone_e164 text generated always as (phone_number) stored;
`);
    await queryRunner.query(`
create index if not exists idx_dnc_list_phone_e164 on public.dnc_list(account_id, phone_e164);
`);
    await queryRunner.query(`
-- garantir update policy
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='dnc_list' and policyname='dnc_update_admin'
  ) then
    create policy "dnc_update_admin" on public.dnc_list
      for update to authenticated using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
  end if;
end $$;
`);
    await queryRunner.query(`
-- 6. company_settings
create table public.company_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  company_name text not null,
  cnpj text,
  support_phone text,
  reply_email text,
  logo_url text,
  legal_footer text,
  collection_window jsonb not null default jsonb_build_object(
    'weekdays', jsonb_build_array(1,2,3,4,5),
    'weekday_start', '08:00',
    'weekday_end',   '20:00',
    'saturday_start','08:00',
    'saturday_end',  '14:00',
    'sunday_enabled', false,
    'holidays_enabled', false
  ),
  max_attempts_per_debtor integer not null default 5,
  attempt_gap_minutes integer not null default 180,
  recording_retention_days integer not null default 90,
  default_discount_pct numeric(5,2) default 10.00,
  default_max_installments integer default 6,
  record_calls boolean not null default true,
  default_agent_id uuid references public.agent_personas(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
alter table public.company_settings enable row level security;
`);
    await queryRunner.query(`
create policy "cs_select_member" on public.company_settings
  for select to authenticated using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "cs_insert_admin" on public.company_settings
  for insert to authenticated with check (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
create policy "cs_update_admin" on public.company_settings
  for update to authenticated using (public.has_role(auth.uid(), account_id, 'admin'::public.app_role));
`);
    await queryRunner.query(`
create trigger tg_company_settings_updated_at
  before update on public.company_settings
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 7. holidays_br
create table public.holidays_br (
  date date primary key,
  name text not null
);
`);
    await queryRunner.query(`
alter table public.holidays_br enable row level security;
`);
    await queryRunner.query(`
create policy "holidays_select_authenticated" on public.holidays_br
  for select to authenticated using (true);
`);
    await queryRunner.query(`
-- 8. Extensões em voice_campaigns
alter table public.voice_campaigns
  add column if not exists campaign_kind text not null default 'collection'
    check (campaign_kind in ('collection','other'));
`);
    await queryRunner.query(`
alter table public.voice_campaigns
  add column if not exists collection_config jsonb not null default jsonb_build_object(
    'discount_pct',     10,
    'max_installments', 6,
    'respect_dnc',      true,
    'respect_window',   true,
    'skip_holidays',    true,
    'priority_by',      'valor_desc'
  );
`);
    await queryRunner.query(`
create index if not exists idx_voice_campaigns_kind
  on public.voice_campaigns(account_id, campaign_kind, status);
`);
    await queryRunner.query(`
-- 9. Extensões em voice_calls
alter table public.voice_calls
  add column if not exists debt_id uuid references public.debts(id) on delete set null;
`);
    await queryRunner.query(`
alter table public.voice_calls
  add column if not exists collection_outcome public.collection_outcome;
`);
    await queryRunner.query(`
alter table public.voice_calls
  add column if not exists retry_count integer not null default 0;
`);
    await queryRunner.query(`
alter table public.voice_calls
  add column if not exists next_retry_at timestamptz;
`);
    await queryRunner.query(`
alter table public.voice_calls
  add column if not exists consent_recorded_at timestamptz;
`);
    await queryRunner.query(`
create index if not exists idx_voice_calls_debt on public.voice_calls(debt_id);
`);
    await queryRunner.query(`
create index if not exists idx_voice_calls_next_retry
  on public.voice_calls(next_retry_at)
  where next_retry_at is not null;
`);
    await queryRunner.query(`
create index if not exists idx_voice_calls_collection_outcome
  on public.voice_calls(account_id, collection_outcome);
`);
    await queryRunner.query(`
-- 10. is_within_collection_window
create or replace function public.is_within_collection_window(
  p_account_id uuid,
  p_at timestamptz default now()
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_config jsonb;
  v_tz text := 'America/Sao_Paulo';
  v_local timestamptz;
  v_dow int;
  v_time time;
  v_is_holiday boolean;
  v_skip_holidays boolean;
  v_sunday_enabled boolean;
  v_weekday_start time;
  v_weekday_end time;
  v_saturday_start time;
  v_saturday_end time;
begin
  select collection_window into v_config
    from public.company_settings where account_id = p_account_id;

  if v_config is null then
    v_config := jsonb_build_object(
      'weekday_start','08:00','weekday_end','20:00',
      'saturday_start','08:00','saturday_end','14:00',
      'sunday_enabled', false, 'holidays_enabled', false
    );
  end if;

  v_local := p_at at time zone v_tz;
  v_dow := extract(isodow from v_local)::int;
  v_time := v_local::time;

  v_skip_holidays := not coalesce((v_config->>'holidays_enabled')::boolean, false);
  v_sunday_enabled := coalesce((v_config->>'sunday_enabled')::boolean, false);
  v_weekday_start := coalesce((v_config->>'weekday_start')::time, '08:00');
  v_weekday_end   := coalesce((v_config->>'weekday_end')::time,   '20:00');
  v_saturday_start := coalesce((v_config->>'saturday_start')::time, '08:00');
  v_saturday_end   := coalesce((v_config->>'saturday_end')::time,   '14:00');

  if v_skip_holidays then
    select exists (select 1 from public.holidays_br where date = v_local::date)
      into v_is_holiday;
    if v_is_holiday then return false; end if;
  end if;

  if v_dow between 1 and 5 then
    return v_time between v_weekday_start and v_weekday_end;
  elsif v_dow = 6 then
    return v_time between v_saturday_start and v_saturday_end;
  else
    return v_sunday_enabled;
  end if;
end
$$;
`);
    await queryRunner.query(`
grant execute on function public.is_within_collection_window(uuid, timestamptz)
  to authenticated, service_role;
`);
    await queryRunner.query(`
-- 11. is_phone_in_dnc
create or replace function public.is_phone_in_dnc(
  p_account_id uuid,
  p_phone_e164 text
) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.dnc_list
    where account_id = p_account_id and phone_number = p_phone_e164
  );
$$;
`);
    await queryRunner.query(`
grant execute on function public.is_phone_in_dnc(uuid, text)
  to authenticated, service_role;
`);
    await queryRunner.query(`
-- 12. trigger tg_cancel_on_dnc
create or replace function public.tg_cancel_on_dnc() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.voice_campaign_contacts
     set status = 'canceled'
   where account_id = new.account_id
     and phone_number = new.phone_number
     and status in ('queued','placed','ringing');
  return new;
end
$$;
`);
    await queryRunner.query(`
drop trigger if exists tg_dnc_cancel_pending on public.dnc_list;
`);
    await queryRunner.query(`
create trigger tg_dnc_cancel_pending
  after insert on public.dnc_list
  for each row execute function public.tg_cancel_on_dnc();
`);
    await queryRunner.query(`
-- 13. bump_debt_attempts
create or replace function public.bump_debt_attempts(p_debt_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.debts
     set attempts_count = coalesce(attempts_count, 0) + 1,
         last_call_at = now()
   where id = p_debt_id;
$$;
`);
    await queryRunner.query(`
grant execute on function public.bump_debt_attempts(uuid)
  to authenticated, service_role;
`);
    await queryRunner.query(`
-- 14. Seed feriados BR 2026
insert into public.holidays_br (date, name) values
  ('2026-01-01','Confraternização Universal'),
  ('2026-02-16','Carnaval'),
  ('2026-02-17','Carnaval'),
  ('2026-02-18','Cinzas'),
  ('2026-04-03','Sexta-feira Santa'),
  ('2026-04-21','Tiradentes'),
  ('2026-05-01','Dia do Trabalho'),
  ('2026-06-04','Corpus Christi'),
  ('2026-09-07','Independência'),
  ('2026-10-12','Nossa Senhora Aparecida'),
  ('2026-11-02','Finados'),
  ('2026-11-15','Proclamação da República'),
  ('2026-11-20','Consciência Negra'),
  ('2026-12-25','Natal')
on conflict (date) do nothing;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424181020 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
