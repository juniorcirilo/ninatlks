import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixes real drift found while testing the invite-accept flow end-to-end
 * for the first time (previously untestable — it depends on RLS actually
 * being enforced, see the migrations right before this one). The live
 * `handle_new_user()` in this dev DB does NOT match either
 * `supabase/migrations/20260430194150_...sql` (the original, which has the
 * invite-token / registration-toggle / primary-workspace-join branches but
 * never sets `is_super_admin`) or any tracked migration — it's a simpler
 * version that always creates a brand-new account and sets
 * `is_super_admin`/`super_admin_onboarding_completed`, with no invite or
 * registration-toggle handling at all. Given `enforce_single_account()`
 * caps `accounts` at exactly one row, that version made every
 * accept-invite attempt after the first signup fail with "Plataforma
 * single-tenant: já existe um workspace" instead of joining the inviter's
 * account.
 *
 * This restores the invite/registration-toggle/primary-workspace logic
 * from the original migration while keeping the is_super_admin bootstrap
 * behavior that's actually relied upon today (confirmed via
 * AuthController.register()) — first user (no invite, no primary account
 * yet) becomes super admin of the one workspace; everyone else (invited or
 * joining the existing primary account) does not.
 */
export class FixHandleNewUser20260720140000 implements MigrationInterface {
  name = 'FixHandleNewUser20260720140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
        v_is_first boolean;
      BEGIN
        user_name := coalesce(
          new.raw_user_meta_data ->> 'name',
          new.raw_user_meta_data ->> 'full_name',
          split_part(new.email, '@', 1)
        );

        SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO v_is_first;

        INSERT INTO public.profiles (
          id, email, name, display_name, confirmed_at,
          is_super_admin, super_admin_onboarding_completed
        )
        VALUES (
          new.id, new.email, user_name, user_name, new.email_confirmed_at,
          v_is_first, NOT v_is_first
        );

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

  public async down(): Promise<void> {
    throw new Error(
      'FixHandleNewUser20260720140000 has no down migration — restores drifted dev-only state, not a schema change to roll back.',
    );
  }
}
