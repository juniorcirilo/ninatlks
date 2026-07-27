import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420185139_87b798b1-b88c-489a-856e-ad24a1beaad8.sql.
export class Migration20260420185139 implements MigrationInterface {
  name = 'Migration20260420185139';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_id text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 12)),
  source text not null check (source in ('user_form', 'meta_callback', 'admin_initiated')),
  email text,
  external_identifier text,
  meta_user_id text,
  reason text,
  raw_payload jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'rejected')),
  processed_at timestamptz,
  processed_by_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  ip_address inet,
  user_agent text
);
`);
    await queryRunner.query(`
create index if not exists idx_ddr_status_created
  on public.data_deletion_requests(status, created_at);
`);
    await queryRunner.query(`
create index if not exists idx_ddr_email on public.data_deletion_requests(lower(email));
`);
    await queryRunner.query(`
create index if not exists idx_ddr_external
  on public.data_deletion_requests(lower(external_identifier));
`);
    await queryRunner.query(`
alter table public.data_deletion_requests enable row level security;
`);
    await queryRunner.query(`
comment on table public.data_deletion_requests is
  'LGPD/GDPR deletion requests from /data-deletion form and Meta callback. Fulfilled manually by DPO within 15 business days.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420185139 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
