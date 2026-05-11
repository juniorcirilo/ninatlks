-- ============================================================
-- Phase 3.2 — Billing + Lead capture integrations
-- ============================================================
-- Generic-enough to host Asaas, Stripe, HubSpot Forms, Typeform behind
-- the same `integrations` table. Each adapter edge function just resolves
-- config + webhook_secret per-account and normalizes payloads before
-- forwarding to workflow-ingest.

create table if not exists public.billing_integrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('asaas','stripe','gerencianet','iugu','generic')),
  config jsonb not null default '{}'::jsonb,       -- api_key, webhook_secret, environment
  enabled boolean not null default true,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider)
);

alter table public.billing_integrations enable row level security;
drop policy if exists "bi_select_member" on public.billing_integrations;
drop policy if exists "bi_write_admin" on public.billing_integrations;
create policy "bi_select_member" on public.billing_integrations
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "bi_write_admin" on public.billing_integrations
  for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
drop trigger if exists set_billing_integrations_updated_at on public.billing_integrations;
create trigger set_billing_integrations_updated_at
  before update on public.billing_integrations
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- lead_sources — HubSpot Forms / Typeform / generic inbound forms
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null check (provider in ('hubspot_forms','typeform','generic')),
  name text not null,
  config jsonb not null default '{}'::jsonb,       -- webhook_secret, form_id, field_map
  enabled boolean not null default true,
  received_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lead_sources_account on public.lead_sources(account_id);

alter table public.lead_sources enable row level security;
drop policy if exists "ls_select_member" on public.lead_sources;
drop policy if exists "ls_write_admin" on public.lead_sources;
create policy "ls_select_member" on public.lead_sources
  for select to authenticated using (is_account_member(auth.uid(), account_id));
create policy "ls_write_admin" on public.lead_sources
  for all to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role))
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
drop trigger if exists set_lead_sources_updated_at on public.lead_sources;
create trigger set_lead_sources_updated_at
  before update on public.lead_sources
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- payments_ledger — minimal cache of payment events so workflows can
-- reference "is this the 3rd payment late?" or "total overdue amount".
-- Real billing data stays at the provider.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.payments_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,

  provider text not null,
  provider_payment_id text not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  status text not null,                            -- 'pending'|'paid'|'overdue'|'refunded'|'canceled'
  due_at timestamptz,
  paid_at timestamptz,
  days_overdue integer generated always as (
    case when due_at is not null and paid_at is null
      then greatest(0, extract(days from (now() - due_at))::int)
      else 0
    end
  ) stored,

  customer_email text,
  customer_phone text,
  description text,
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider, provider_payment_id)
);

create index if not exists idx_payments_account_status
  on public.payments_ledger(account_id, status, due_at desc);
create index if not exists idx_payments_contact
  on public.payments_ledger(contact_id) where contact_id is not null;

alter table public.payments_ledger enable row level security;
drop policy if exists "pl_select_member" on public.payments_ledger;
create policy "pl_select_member" on public.payments_ledger
  for select to authenticated using (is_account_member(auth.uid(), account_id));

drop trigger if exists set_payments_ledger_updated_at on public.payments_ledger;
create trigger set_payments_ledger_updated_at
  before update on public.payments_ledger
  for each row execute function public.tg_set_updated_at();
