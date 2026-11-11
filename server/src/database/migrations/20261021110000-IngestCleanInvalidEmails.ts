import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Limpeza de e-mails inválidos ao fim de cada sincronização (n8n/ERP).
 * Zera o e-mail (não apaga o contato) quando não passa no formato básico.
 * SECURITY DEFINER pelo mesmo motivo das demais funções ingest_*: a
 * ingestão roda fora da transação com RLS, então recebe a conta já resolvida.
 */
export class IngestCleanInvalidEmails20261021110000
  implements MigrationInterface
{
  name = 'IngestCleanInvalidEmails20261021110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.ingest_clean_invalid_emails(_account_id uuid)
      RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_count integer;
      BEGIN
        UPDATE public.contacts
           SET email = NULL
         WHERE account_id = _account_id
           AND email IS NOT NULL
           AND TRIM(email) <> ''
           AND email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$';
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count;
      END;
      $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.ingest_clean_invalid_emails(uuid) FROM PUBLIC;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.ingest_clean_invalid_emails(uuid) TO ninatlks_app;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.ingest_clean_invalid_emails(uuid)`,
    );
  }
}
