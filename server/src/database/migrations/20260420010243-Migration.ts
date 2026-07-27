import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420010243_7cd7640c-0d16-4eea-864b-3b2c08fb1386.sql.
export class Migration20260420010243 implements MigrationInterface {
  name = 'Migration20260420010243';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Twilio integration — SMS + recordings + transcription + provisioning
-- Re-applied (original 20260417200000 was in repo but not in DB history).

-- 1. 'sms' channel_type
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
`);
    await queryRunner.query(`
-- 2. sms_opt_outs
create table if not exists public.sms_opt_outs (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  phone_number text not null,
  reason text,
  opted_out_at timestamptz not null default now(),
  opted_back_in_at timestamptz,
  unique (account_id, phone_number)
);
`);
    await queryRunner.query(`
create index if not exists idx_sms_opt_outs_account on public.sms_opt_outs(account_id);
`);
    await queryRunner.query(`
alter table public.sms_opt_outs enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "sms_opt_select_member" on public.sms_opt_outs;
`);
    await queryRunner.query(`
create policy "sms_opt_select_member" on public.sms_opt_outs
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- 3. voice_calls — recording + transcription columns
alter table public.voice_calls
  add column if not exists recording_sid text,
  add column if not exists recording_storage_path text,
  add column if not exists recording_duration_sec integer,
  add column if not exists transcription_status text default 'idle'
      check (transcription_status in ('idle','pending','processing','done','failed')),
  add column if not exists transcription_provider text,
  add column if not exists transcription_error text,
  add column if not exists transcription_completed_at timestamptz;
`);
    await queryRunner.query(`
create index if not exists idx_voice_calls_recording_sid
  on public.voice_calls(recording_sid)
  where recording_sid is not null;
`);
    await queryRunner.query(`
create index if not exists idx_voice_calls_tx_pending
  on public.voice_calls(account_id, created_at desc)
  where transcription_status in ('pending','processing');
`);
    await queryRunner.query(`
-- 4. twilio_number_provisioning — admin audit trail
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
`);
    await queryRunner.query(`
create index if not exists idx_twilio_prov_account
  on public.twilio_number_provisioning(account_id, created_at desc);
`);
    await queryRunner.query(`
alter table public.twilio_number_provisioning enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "twprov_select_admin" on public.twilio_number_provisioning;
`);
    await queryRunner.query(`
create policy "twprov_select_admin" on public.twilio_number_provisioning
  for select to authenticated using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- 5. phone_numbers.provider_config documentation
comment on column public.phone_numbers.provider_config is
$$Shape for Twilio numbers:
{
  twilio_sid: string,
  capabilities: { voice: bool, sms: bool, mms: bool, fax: bool },
  messaging_service_sid: string,
  forward_to: string,
  voice_url: string,
  sms_url: string
}
SMS uses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN (global env)
OR per-channel config.twilio_account_sid + config.twilio_auth_token.$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420010243 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
