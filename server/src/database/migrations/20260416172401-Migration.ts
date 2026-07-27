import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416172401_f2dd41c7-313d-4c97-86c2-285feb17f2b6.sql.
export class Migration20260416172401 implements MigrationInterface {
  name = 'Migration20260416172401';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- ENUMS
-- ============================================================
create type public.app_role as enum ('admin', 'agent');
`);
    await queryRunner.query(`
create type public.account_status as enum ('active', 'suspended', 'archived');
`);
    await queryRunner.query(`
create type public.user_availability as enum ('online', 'offline', 'busy');
`);
    await queryRunner.query(`
-- ============================================================
-- ACCOUNTS (workspace / tenant)
-- ============================================================
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  locale text not null default 'pt-BR',
  domain text,
  support_email text,
  settings jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  internal_attributes jsonb not null default '{}'::jsonb,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
-- ============================================================
-- PROFILES (1:1 com auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  display_name text,
  availability public.user_availability not null default 'offline',
  custom_attributes jsonb not null default '{}'::jsonb,
  ui_settings jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
-- ============================================================
-- ACCOUNT_USERS (pivot)
-- ============================================================
create table public.account_users (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  availability public.user_availability not null default 'offline',
  auto_offline boolean not null default true,
  active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_id)
);
`);
    await queryRunner.query(`
create index idx_account_users_account on public.account_users(account_id);
`);
    await queryRunner.query(`
create index idx_account_users_user on public.account_users(user_id);
`);
    await queryRunner.query(`
-- ============================================================
-- USER_ROLES (separada por segurança — evita privilege escalation)
-- ============================================================
create table public.user_roles (
  id bigserial primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (account_id, user_id, role)
);
`);
    await queryRunner.query(`
create index idx_user_roles_user on public.user_roles(user_id);
`);
    await queryRunner.query(`
create index idx_user_roles_account on public.user_roles(account_id);
`);
    await queryRunner.query(`
-- ============================================================
-- SECURITY DEFINER FUNCTIONS (evitam recursão em RLS)
-- ============================================================
create or replace function public.has_role(_user_id uuid, _account_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and account_id = _account_id and role = _role
  )
$$;
`);
    await queryRunner.query(`
create or replace function public.is_account_member(_user_id uuid, _account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_users
    where user_id = _user_id and account_id = _account_id
  )
$$;
`);
    await queryRunner.query(`
-- ============================================================
-- TRIGGER: updated_at
-- ============================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
`);
    await queryRunner.query(`
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
create trigger trg_account_users_updated_at
  before update on public.account_users
  for each row execute function public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- ============================================================
-- TRIGGER: ao criar usuário em auth.users, criar profile + account + account_user + role admin
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
  account_name text;
  user_name text;
begin
  user_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  account_name := coalesce(
    new.raw_user_meta_data ->> 'workspace_name',
    user_name || ' Workspace'
  );

  -- 1. Profile
  insert into public.profiles (id, email, name, display_name, confirmed_at)
  values (new.id, new.email, user_name, user_name, new.email_confirmed_at);

  -- 2. Account inicial
  insert into public.accounts (name, support_email)
  values (account_name, new.email)
  returning id into new_account_id;

  -- 3. Membership
  insert into public.account_users (account_id, user_id)
  values (new_account_id, new.id);

  -- 4. Role admin
  insert into public.user_roles (account_id, user_id, role)
  values (new_account_id, new.id, 'admin');

  return new;
end;
$$;
`);
    await queryRunner.query(`
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
`);
    await queryRunner.query(`
-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.accounts enable row level security;
`);
    await queryRunner.query(`
alter table public.profiles enable row level security;
`);
    await queryRunner.query(`
alter table public.account_users enable row level security;
`);
    await queryRunner.query(`
alter table public.user_roles enable row level security;
`);
    await queryRunner.query(`
-- profiles: cada usuário lê/atualiza o seu próprio
create policy "profile_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);
`);
    await queryRunner.query(`
create policy "profile_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);
`);
    await queryRunner.query(`
-- accounts: membros podem ver; admins podem atualizar
create policy "account_select_member"
  on public.accounts for select
  to authenticated
  using (public.is_account_member(auth.uid(), id));
`);
    await queryRunner.query(`
create policy "account_update_admin"
  on public.accounts for update
  to authenticated
  using (public.has_role(auth.uid(), id, 'admin'));
`);
    await queryRunner.query(`
-- account_users: membros do mesmo workspace podem se ver
create policy "account_users_select_same_workspace"
  on public.account_users for select
  to authenticated
  using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- admins podem inserir/remover membros
create policy "account_users_insert_admin"
  on public.account_users for insert
  to authenticated
  with check (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create policy "account_users_delete_admin"
  on public.account_users for delete
  to authenticated
  using (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
-- usuário pode atualizar seu próprio status (availability)
create policy "account_users_update_self"
  on public.account_users for update
  to authenticated
  using (auth.uid() = user_id);
`);
    await queryRunner.query(`
-- user_roles: membros do workspace podem ver papéis do workspace
create policy "user_roles_select_member"
  on public.user_roles for select
  to authenticated
  using (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- somente admins gerenciam papéis
create policy "user_roles_insert_admin"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
create policy "user_roles_delete_admin"
  on public.user_roles for delete
  to authenticated
  using (public.has_role(auth.uid(), account_id, 'admin'));
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416172401 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
