import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260430194150_c2764c2e-be28-46d3-91cf-28581431e624.sql.
export class Migration20260430194150 implements MigrationInterface {
  name = 'Migration20260430194150';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- 1. Tabela system_settings (singleton)
create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  registration_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
alter table public.system_settings enable row level security;
`);
    await queryRunner.query(`
-- RLS PERMISSIVAS
drop policy if exists "auth read system_settings" on public.system_settings;
`);
    await queryRunner.query(`
drop policy if exists "anon read system_settings" on public.system_settings;
`);
    await queryRunner.query(`
drop policy if exists "auth insert system_settings" on public.system_settings;
`);
    await queryRunner.query(`
drop policy if exists "auth update system_settings" on public.system_settings;
`);
    await queryRunner.query(`
create policy "auth read system_settings"
  on public.system_settings for select to authenticated using (true);
`);
    await queryRunner.query(`
create policy "anon read system_settings"
  on public.system_settings for select to anon using (true);
`);
    await queryRunner.query(`
create policy "auth insert system_settings"
  on public.system_settings for insert to authenticated with check (true);
`);
    await queryRunner.query(`
create policy "auth update system_settings"
  on public.system_settings for update to authenticated using (true) with check (true);
`);
    await queryRunner.query(`
-- Trigger de updated_at (reusa update_updated_at_column se existir)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at_column' and pronamespace = 'public'::regnamespace) then
    execute 'drop trigger if exists system_settings_updated_at on public.system_settings';
    execute 'create trigger system_settings_updated_at before update on public.system_settings for each row execute function public.update_updated_at_column()';
  end if;
end$$;
`);
    await queryRunner.query(`
-- 2. signup_open() agora consulta system_settings com default true
create or replace function public.signup_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select registration_enabled from public.system_settings limit 1),
    true
  );
$$;
`);
    await queryRunner.query(`
-- 3. handle_new_user: substitui bloqueio por toggle
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  new_account_id uuid;
  user_name text;
  v_invite_token text;
  v_invite RECORD;
  v_primary_id uuid;
  v_registration_enabled boolean;
BEGIN
  user_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'full_name',
    split_part(new.email, '@', 1)
  );

  INSERT INTO public.profiles (id, email, name, display_name, confirmed_at)
  VALUES (new.id, new.email, user_name, user_name, new.email_confirmed_at);

  -- Caminho 1: signup com token de convite
  v_invite_token := new.raw_user_meta_data ->> 'invite_token';
  IF v_invite_token IS NOT NULL AND length(v_invite_token) > 0 THEN
    SELECT id, account_id, role INTO v_invite FROM public.invites
      WHERE token = v_invite_token
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now();
    IF FOUND THEN
      INSERT INTO public.account_users (account_id, user_id)
        VALUES (v_invite.account_id, new.id);
      INSERT INTO public.user_roles (account_id, user_id, role)
        VALUES (v_invite.account_id, new.id, v_invite.role)
        ON CONFLICT DO NOTHING;
      UPDATE public.invites
        SET accepted_at = now(), accepted_by_user_id = new.id
        WHERE id = v_invite.id;
      RETURN new;
    ELSE
      DELETE FROM public.profiles WHERE id = new.id;
      RAISE EXCEPTION 'Convite inválido ou expirado. Solicite um novo link ao administrador.';
    END IF;
  END IF;

  -- Caminho 2: toggle de registro
  SELECT coalesce(
    (select registration_enabled from public.system_settings limit 1),
    true
  ) INTO v_registration_enabled;

  IF NOT v_registration_enabled THEN
    DELETE FROM public.profiles WHERE id = new.id;
    RAISE EXCEPTION 'Cadastros desativados. Solicite um convite ao administrador.';
  END IF;

  -- Existe workspace primário? Entra como agent.
  SELECT id INTO v_primary_id FROM public.accounts WHERE is_primary = true LIMIT 1;

  IF v_primary_id IS NOT NULL THEN
    INSERT INTO public.account_users (account_id, user_id)
      VALUES (v_primary_id, new.id)
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (account_id, user_id, role)
      VALUES (v_primary_id, new.id, 'agent')
      ON CONFLICT DO NOTHING;
    RETURN new;
  END IF;

  -- Caminho 3: 1º signup → cria workspace e vira admin
  INSERT INTO public.accounts (name, support_email, is_primary)
    VALUES ('Nina Talks', new.email, true)
    RETURNING id INTO new_account_id;

  INSERT INTO public.account_users (account_id, user_id)
    VALUES (new_account_id, new.id);

  INSERT INTO public.user_roles (account_id, user_id, role)
    VALUES (new_account_id, new.id, 'admin');

  INSERT INTO public.org_onboarding_state (account_id) VALUES (new_account_id);

  RETURN new;
END;
$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260430194150 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
