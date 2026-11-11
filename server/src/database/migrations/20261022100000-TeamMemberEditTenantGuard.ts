import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Endurece team_update_member / team_set_member_password: um admin só pode
 * mexer em e-mail/senha de quem pertence EXCLUSIVAMENTE ao workspace dele.
 * Sem isso, o admin do workspace A trocaria e-mail/senha de um usuário que
 * também é membro do workspace B e assumiria a conta dele (takeover
 * cross-tenant). Também exige sessão autenticada (auth.uid() não nulo).
 */
export class TeamMemberEditTenantGuard20261022100000
  implements MigrationInterface
{
  name = 'TeamMemberEditTenantGuard20261022100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const guard = `
        IF auth.uid() IS NULL
           OR NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
          RAISE EXCEPTION 'forbidden';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.account_users
                       WHERE account_id = p_account_id AND user_id = p_target_user_id) THEN
          RAISE EXCEPTION 'Membro não encontrado neste workspace.';
        END IF;
        IF EXISTS (SELECT 1 FROM public.account_users
                   WHERE user_id = p_target_user_id AND account_id <> p_account_id) THEN
          RAISE EXCEPTION 'Este usuário pertence a outro workspace e não pode ser editado aqui.';
        END IF;`;

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.team_update_member(
        p_account_id uuid, p_target_user_id uuid, p_name text, p_email text
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_email text := lower(btrim(p_email));
        v_name text := btrim(p_name);
      BEGIN${guard}
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
        p_account_id uuid, p_target_user_id uuid, p_password_hash text, p_password_algo text
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN${guard}
        UPDATE public.profiles
           SET password_hash = p_password_hash, password_algo = p_password_algo
         WHERE id = p_target_user_id;
      END;
      $$;
    `);
  }

  public async down(): Promise<void> {
    // Mantém a versão endurecida; a anterior (20261021100000) é insegura.
  }
}
