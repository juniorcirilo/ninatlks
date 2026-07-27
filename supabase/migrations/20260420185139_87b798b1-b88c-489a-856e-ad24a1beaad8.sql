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

create index if not exists idx_ddr_status_created
  on public.data_deletion_requests(status, created_at);
create index if not exists idx_ddr_email on public.data_deletion_requests(lower(email));
create index if not exists idx_ddr_external
  on public.data_deletion_requests(lower(external_identifier));

alter table public.data_deletion_requests enable row level security;

comment on table public.data_deletion_requests is
  'LGPD/GDPR deletion requests from /data-deletion form and Meta callback. Fulfilled manually by DPO within 15 business days.';