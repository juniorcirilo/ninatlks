import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416233524_06f0f69f-a028-4dd3-8fe2-b7b46d15d1c4.sql.
export class Migration20260416233524 implements MigrationInterface {
  name = 'Migration20260416233524';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- 1. STORAGE BUCKETS + RLS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
`);
    await queryRunner.query(`
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
`);
    await queryRunner.query(`
insert into storage.buckets (id, name, public)
values ('voice-recordings', 'voice-recordings', false)
on conflict (id) do nothing;
`);
    await queryRunner.query(`
-- Avatars: anyone can read; user uploads to own folder (uid)
create policy "Avatars publicly readable"
on storage.objects for select
using (bucket_id = 'avatars');
`);
    await queryRunner.query(`
create policy "Users upload own avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);
`);
    await queryRunner.query(`
create policy "Users update own avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);
`);
    await queryRunner.query(`
create policy "Users delete own avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);
`);
    await queryRunner.query(`
-- Attachments: scoped to account_id (first folder)
create policy "Account members read attachments"
on storage.objects for select
using (
  bucket_id = 'attachments'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
create policy "Account members upload attachments"
on storage.objects for insert
with check (
  bucket_id = 'attachments'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
create policy "Account members delete attachments"
on storage.objects for delete
using (
  bucket_id = 'attachments'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
-- Voice recordings: same pattern
create policy "Account members read voice-recordings"
on storage.objects for select
using (
  bucket_id = 'voice-recordings'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
create policy "Account members upload voice-recordings"
on storage.objects for insert
with check (
  bucket_id = 'voice-recordings'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
create policy "Account members delete voice-recordings"
on storage.objects for delete
using (
  bucket_id = 'voice-recordings'
  and public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
-- ============================================================
-- 2. SCHEMA HARDENING
-- ============================================================

-- companies
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  domain text,
  size text,
  industry text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists companies_account_id_idx on public.companies(account_id);
`);
    await queryRunner.query(`
alter table public.companies
  add column if not exists domain text,
  add column if not exists size text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
`);
    await queryRunner.query(`
create index if not exists companies_domain_idx on public.companies(account_id, domain);
`);
    await queryRunner.query(`
alter table public.companies enable row level security;
`);
    await queryRunner.query(`
create policy "Account members read companies"
on public.companies for select
using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "Account members create companies"
on public.companies for insert
with check (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "Account members update companies"
on public.companies for update
using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "Admins delete companies"
on public.companies for delete
using (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create trigger companies_updated_at
before update on public.companies
for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- contacts.company_id FK (column already exists per types.ts, just enforce FK)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'contacts_company_id_fkey'
      and table_name = 'contacts'
  ) then
    alter table public.contacts
      add constraint contacts_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete set null;
  end if;
end $$;
`);
    await queryRunner.query(`
-- audit_log
create table if not exists public.audit_log (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
alter table public.audit_log
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists ip_address text,
  add column if not exists user_agent text;
`);
    await queryRunner.query(`
create index if not exists audit_log_account_created_idx
  on public.audit_log(account_id, created_at desc);
`);
    await queryRunner.query(`
create index if not exists audit_log_resource_idx
  on public.audit_log(resource_type, resource_id);
`);
    await queryRunner.query(`
alter table public.audit_log enable row level security;
`);
    await queryRunner.query(`
create policy "Admins read audit_log"
on public.audit_log for select
using (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
-- Service role inserts only (no public insert policy)

-- Performance indexes (idempotent)
create index if not exists conversations_account_status_activity_idx
  on public.conversations(account_id, status, last_activity_at desc);
`);
    await queryRunner.query(`
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at);
`);
    await queryRunner.query(`
create index if not exists messages_account_created_idx
  on public.messages(account_id, created_at desc);
`);
    await queryRunner.query(`
-- ============================================================
-- 3. SEED DEFAULTS (prompt_templates)
-- ============================================================

create table if not exists public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  key text not null,
  name text not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, key)
);
`);
    await queryRunner.query(`
create index if not exists prompt_templates_account_idx on public.prompt_templates(account_id);
`);
    await queryRunner.query(`
alter table public.prompt_templates enable row level security;
`);
    await queryRunner.query(`
create policy "Account members read prompt_templates"
on public.prompt_templates for select
using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "Admins manage prompt_templates insert"
on public.prompt_templates for insert
with check (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create policy "Admins manage prompt_templates update"
on public.prompt_templates for update
using (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create policy "Admins manage prompt_templates delete"
on public.prompt_templates for delete
using (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create trigger prompt_templates_updated_at
before update on public.prompt_templates
for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- Trigger: seed default prompt on every new account
create or replace function public.tg_seed_account_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.prompt_templates (account_id, key, name, body, variables)
  values (
    new.id,
    'default-reply',
    'Resposta padrão',
    'Você é um atendente virtual cordial e objetivo da {{company_name}}. ' ||
    'Responda em português, com tom profissional e acolhedor. ' ||
    'Se não souber a resposta, ofereça transferir para um humano. ' ||
    'Histórico:\\n{{conversation_history}}\\n\\nMensagem do cliente: {{customer_message}}',
    '["company_name","conversation_history","customer_message"]'::jsonb
  )
  on conflict (account_id, key) do nothing;
  return new;
end;
$$;
`);
    await queryRunner.query(`
drop trigger if exists trg_seed_account_defaults on public.accounts;
`);
    await queryRunner.query(`
create trigger trg_seed_account_defaults
after insert on public.accounts
for each row execute function public.tg_seed_account_defaults();
`);
    await queryRunner.query(`
-- Backfill: seed default for existing accounts
insert into public.prompt_templates (account_id, key, name, body, variables)
select
  id,
  'default-reply',
  'Resposta padrão',
  'Você é um atendente virtual cordial e objetivo da {{company_name}}. ' ||
  'Responda em português, com tom profissional e acolhedor. ' ||
  'Se não souber a resposta, ofereça transferir para um humano. ' ||
  'Histórico:\\n{{conversation_history}}\\n\\nMensagem do cliente: {{customer_message}}',
  '["company_name","conversation_history","customer_message"]'::jsonb
from public.accounts
on conflict (account_id, key) do nothing;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416233524 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
