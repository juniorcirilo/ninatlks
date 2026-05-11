-- ============================================================
-- Data Deletion Requests — LGPD/GDPR + Meta App Review
-- ============================================================
-- Meta App Review requires a Data Deletion Callback URL. Rather than
-- processing deletions synchronously (risky + slow), we queue requests in
-- this table and fulfill within 15 business days. The public form at
-- /data-deletion and the Meta callback both insert here; admins process
-- via the /admin (future) page or CLI.

create table if not exists public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  confirmation_id text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 12)),

  -- Request origin
  source text not null check (source in ('user_form', 'meta_callback', 'admin_initiated')),

  -- Identifying fields — at least one of these must be present
  email text,                       -- email provided by requester
  external_identifier text,         -- @instagram / +phone / messenger PSID
  meta_user_id text,                -- signed_request.user_id from Meta callback

  reason text,
  raw_payload jsonb,                -- full request body for audit

  -- Fulfillment state
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

-- No select/insert/update policies for authenticated role — only service_role
-- (edge functions) and future admin tooling should touch this table.
-- Anyone authenticated would effectively see another user's request; that's
-- explicitly blocked by having no permissive policy.

comment on table public.data_deletion_requests is
  'LGPD/GDPR deletion requests from /data-deletion form and Meta callback. Fulfilled manually by DPO within 15 business days.';
