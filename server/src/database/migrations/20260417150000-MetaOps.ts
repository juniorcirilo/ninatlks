import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260417150000_meta_ops.sql.
export class MetaOps20260417150000 implements MigrationInterface {
  name = 'MetaOps20260417150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Meta ops: rate limit telemetry + dispatch retry queue + messenger channel
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. channel_usage_metrics — snapshot of Meta rate-limit headers
-- ─────────────────────────────────────────────────────────────
-- One row per (channel, product_kind, window_hour) so we can build a 24h
-- rolling view + alert when call/cpu/total usage crosses 80%.
create table if not exists public.channel_usage_metrics (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  product_kind text not null,                -- 'whatsapp' | 'messenger' | 'instagram'
  bucket_hour timestamptz not null,          -- truncated to hour
  call_count int not null default 0,
  total_time_pct int,                        -- max seen in bucket
  total_cputime_pct int,
  call_volume_pct int,
  raw_latest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, product_kind, bucket_hour)
);
`);
    await queryRunner.query(`
create index if not exists idx_channel_usage_account_bucket
  on public.channel_usage_metrics(account_id, bucket_hour desc);
`);
    await queryRunner.query(`
alter table public.channel_usage_metrics enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "cum_select_member" on public.channel_usage_metrics;
`);
    await queryRunner.query(`
create policy "cum_select_member" on public.channel_usage_metrics
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- Inserts/updates: only service role.

drop trigger if exists set_channel_usage_updated_at on public.channel_usage_metrics;
`);
    await queryRunner.query(`
create trigger set_channel_usage_updated_at
  before update on public.channel_usage_metrics
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- Upsert helper so edge functions don't duplicate increment logic everywhere.
create or replace function public.record_channel_usage(
  p_account_id uuid,
  p_channel_id uuid,
  p_product_kind text,
  p_total_time_pct int,
  p_total_cputime_pct int,
  p_call_volume_pct int,
  p_raw jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.channel_usage_metrics as m (
    account_id, channel_id, product_kind, bucket_hour,
    call_count, total_time_pct, total_cputime_pct, call_volume_pct, raw_latest
  )
  values (
    p_account_id, p_channel_id, p_product_kind, date_trunc('hour', now()),
    1, p_total_time_pct, p_total_cputime_pct, p_call_volume_pct, p_raw
  )
  on conflict (channel_id, product_kind, bucket_hour) do update
    set call_count = m.call_count + 1,
        total_time_pct = greatest(coalesce(m.total_time_pct, 0), coalesce(excluded.total_time_pct, 0)),
        total_cputime_pct = greatest(coalesce(m.total_cputime_pct, 0), coalesce(excluded.total_cputime_pct, 0)),
        call_volume_pct = greatest(coalesce(m.call_volume_pct, 0), coalesce(excluded.call_volume_pct, 0)),
        raw_latest = excluded.raw_latest,
        updated_at = now();
end;
$$;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 2. Dispatch retry queue — rows scanned by \`dispatch-retry\` job
-- ─────────────────────────────────────────────────────────────
-- We keep retry metadata inside messages.additional_attributes.dispatch to
-- avoid a second table, but we add an index so the retry scanner is cheap.
create index if not exists idx_messages_dispatch_retry
  on public.messages (account_id, created_at desc)
  where (additional_attributes -> 'dispatch' ->> 'status') = 'failed'
    and coalesce((additional_attributes -> 'dispatch' ->> 'retry_count')::int, 0) < 3;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 3. Messenger channel type support
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'channel_type' and pg_enum.enumlabel = 'messenger'
  ) then
    alter type public.channel_type add value 'messenger';
  end if;
end $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'MetaOps20260417150000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
