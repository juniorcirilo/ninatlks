import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Equipe > Membros: edição de nome/e-mail e redefinição de senha por um admin.
 * As duas funções validam (admin do workspace + alvo é membro dele) e rodam
 * como SECURITY DEFINER porque a RLS de profiles não deixa um admin escrever
 * no perfil de outro usuário.
 */
export class TeamMemberEdit20261021100000 implements MigrationInterface {
  name = 'TeamMemberEdit20261021100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.team_update_member(
        p_account_id uuid,
        p_target_user_id uuid,
        p_name text,
        p_email text
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_email text := lower(btrim(p_email));
        v_name text := btrim(p_name);
      BEGIN
        IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
          RAISE EXCEPTION 'forbidden';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.account_users
                       WHERE account_id = p_account_id AND user_id = p_target_user_id) THEN
          RAISE EXCEPTION 'Membro não encontrado neste workspace.';
        END IF;
        IF v_name = '' OR v_email = '' OR position('@' in v_email) = 0 THEN
          RAISE EXCEPTION 'Nome e e-mail válidos são obrigatórios.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.profiles
                   WHERE lower(email) = v_email AND id <> p_target_user_id) THEN
          RAISE EXCEPTION 'Já existe um usuário com este e-mail.';
        END IF;

        UPDATE public.profiles
           SET name = v_name, display_name = v_name, email = v_email
         WHERE id = p_target_user_id;
        UPDATE auth.users SET email = v_email WHERE id = p_target_user_id;
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.team_set_member_password(
        p_account_id uuid,
        p_target_user_id uuid,
        p_password_hash text,
        p_password_algo text
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
          RAISE EXCEPTION 'forbidden';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.account_users
                       WHERE account_id = p_account_id AND user_id = p_target_user_id) THEN
          RAISE EXCEPTION 'Membro não encontrado neste workspace.';
        END IF;
        UPDATE public.profiles
           SET password_hash = p_password_hash, password_algo = p_password_algo
         WHERE id = p_target_user_id;
      END;
      $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.team_update_member(uuid, uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.team_set_member_password(uuid, uuid, text, text) FROM PUBLIC;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          GRANT EXECUTE ON FUNCTION public.team_update_member(uuid, uuid, text, text) TO authenticated;
          GRANT EXECUTE ON FUNCTION public.team_set_member_password(uuid, uuid, text, text) TO authenticated;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.team_update_member(uuid, uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.team_set_member_password(uuid, uuid, text, text) TO ninatlks_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.team_update_member(uuid, uuid, text, text)`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.team_set_member_password(uuid, uuid, text, text)`,
    );
  }
}
