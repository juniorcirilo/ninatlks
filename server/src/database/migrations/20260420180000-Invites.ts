import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420180000_invites.sql.
export class Invites20260420180000 implements MigrationInterface {
  name = 'Invites20260420180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Invites — team onboarding for existing accounts
-- ============================================================
-- Today, every signup goes through handle_new_user(), which creates a new
-- account and promotes the user to admin. That's correct for the first
-- signup of an org, but wrong for the 2nd, 3rd, Nth user — they should
-- join the existing workspace as 'agent' (or 'admin' by invite).
--
-- Flow:
--   1. An admin creates an invite row (token + role). They share the URL
--      /auth?invite=<token> (manually or via Supabase magic link email).
--   2. Invitee visits /auth?invite=<token>, signs up normally. The frontend
--      passes the invite_token inside auth.signUp \`data\`.
--   3. handle_new_user reads raw_user_meta_data->>'invite_token'. If present
--      and valid, it joins the existing account_id instead of creating a new
--      one. If absent/invalid, default solo-signup path.
--   4. Invite row gets accepted_at stamped so it can't be reused.

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'agent'::public.app_role,
  token text not null unique default encode(gen_random_bytes(24), 'base64'),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
create index if not exists idx_invites_account on public.invites(account_id, accepted_at);
`);
    await queryRunner.query(`
create index if not exists idx_invites_email_pending on public.invites(lower(email))
  where accepted_at is null and revoked_at is null;
`);
    await queryRunner.query(`
alter table public.invites enable row level security;
`);
    await queryRunner.query(`
drop policy if exists "invites_select_member" on public.invites;
`);
    await queryRunner.query(`
drop policy if exists "invites_insert_admin" on public.invites;
`);
    await queryRunner.query(`
drop policy if exists "invites_update_admin" on public.invites;
`);
    await queryRunner.query(`
drop policy if exists "invites_delete_admin" on public.invites;
`);
    await queryRunner.query(`
-- Account members can see all invites on their account (audit trail).
create policy "invites_select_member" on public.invites
  for select to authenticated
  using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- Only admins create/revoke.
create policy "invites_insert_admin" on public.invites
  for insert to authenticated
  with check (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
create policy "invites_update_admin" on public.invites
  for update to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
create policy "invites_delete_admin" on public.invites
  for delete to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- ============================================================
-- RPC: accept an invite for the already-authenticated caller.
-- ============================================================
-- Used when an existing user (already logged in) clicks an invite link and
-- wants to join a second workspace. Not used on first signup — that's
-- handled in handle_new_user directly.
create or replace function public.invites_accept(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'must be authenticated';
  end if;

  select * into v_invite from public.invites
    where token = p_token
      and accepted_at is null
      and revoked_at is null
      and expires_at > now()
    for update;
  if not found then
    raise exception 'invite not found or expired';
  end if;

  -- Already a member? Just stamp the invite as accepted and bail out.
  if exists (select 1 from public.account_users where account_id = v_invite.account_id and user_id = v_user_id) then
    update public.invites set accepted_at = now(), accepted_by_user_id = v_user_id where id = v_invite.id;
    return v_invite.account_id;
  end if;

  insert into public.account_users (account_id, user_id) values (v_invite.account_id, v_user_id);
  insert into public.user_roles (account_id, user_id, role) values (v_invite.account_id, v_user_id, v_invite.role)
    on conflict do nothing;

  update public.invites set accepted_at = now(), accepted_by_user_id = v_user_id where id = v_invite.id;

  return v_invite.account_id;
end;
$$;
`);
    await queryRunner.query(`
grant execute on function public.invites_accept(text) to authenticated;
`);
    await queryRunner.query(`
-- ============================================================
-- Replace handle_new_user to honor invite_token in metadata.
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
  v_invite_token text;
  v_invite public.invites;
begin
  user_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  -- Profile is always created for any signup.
  insert into public.profiles (id, email, name, display_name, confirmed_at)
  values (new.id, new.email, user_name, user_name, new.email_confirmed_at);

  -- Branch 1: signup came via invite.
  v_invite_token := new.raw_user_meta_data ->> 'invite_token';
  if v_invite_token is not null and length(v_invite_token) > 0 then
    select * into v_invite from public.invites
      where token = v_invite_token
        and accepted_at is null
        and revoked_at is null
        and expires_at > now();
    if found then
      insert into public.account_users (account_id, user_id)
        values (v_invite.account_id, new.id);
      insert into public.user_roles (account_id, user_id, role)
        values (v_invite.account_id, new.id, v_invite.role)
        on conflict do nothing;
      update public.invites
        set accepted_at = now(), accepted_by_user_id = new.id
        where id = v_invite.id;
      return new;
    end if;
    -- Invalid / expired invite → fall through to solo signup. Admins can
    -- audit the failed attempt via the unreferenced token.
  end if;

  -- Branch 2: default solo signup — new workspace + admin + onboarding.
  account_name := coalesce(
    new.raw_user_meta_data ->> 'workspace_name',
    user_name || ' Workspace'
  );

  insert into public.accounts (name, support_email)
    values (account_name, new.email)
    returning id into new_account_id;

  insert into public.account_users (account_id, user_id)
    values (new_account_id, new.id);

  insert into public.user_roles (account_id, user_id, role)
    values (new_account_id, new.id, 'admin');

  insert into public.org_onboarding_state (account_id) values (new_account_id);

  return new;
end;
$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Invites20260420180000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
