import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Parcelas do mesmo título eram sobrescritas: a chave única de
 * `cobranca_titulos` era (conta, contato, numero_titulo), então "1/3", "2/3" e
 * "3/3" viravam uma linha só — o app mostrava bem menos títulos do que a fonte
 * (n8n/ERP) devolve. A chave passa a incluir a parcela, e o upsert de
 * `ingest_agent_contact` acompanha.
 */
export class CobrancaTituloUniqueParcela20261027100000
  implements MigrationInterface
{
  name = 'CobrancaTituloUniqueParcela20261027100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.cobranca_titulos_account_contact_numero_uniq;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS cobranca_titulos_account_contact_numero_parcela_uniq
        ON public.cobranca_titulos (account_id, contact_id, numero_titulo, (coalesce(parcela, '')))
        WHERE numero_titulo IS NOT NULL;
    `);

    // Reaproveita a definição vigente da função (várias migrations a
    // reescreveram) trocando só o alvo do ON CONFLICT dos títulos.
    await queryRunner.query(`
      DO $$
      DECLARE
        v_def text := pg_get_functiondef('public.ingest_agent_contact'::regproc);
        v_old text := 'on conflict (account_id, contact_id, numero_titulo) where numero_titulo is not null';
        v_new text := 'on conflict (account_id, contact_id, numero_titulo, (coalesce(parcela, ''''))) where numero_titulo is not null';
      BEGIN
        IF position(v_old in v_def) = 0 THEN
          RAISE EXCEPTION 'ON CONFLICT de cobranca_titulos não encontrado em ingest_agent_contact';
        END IF;
        EXECUTE replace(v_def, v_old, v_new);
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        v_def text := pg_get_functiondef('public.ingest_agent_contact'::regproc);
        v_new text := 'on conflict (account_id, contact_id, numero_titulo, (coalesce(parcela, ''''))) where numero_titulo is not null';
        v_old text := 'on conflict (account_id, contact_id, numero_titulo) where numero_titulo is not null';
      BEGIN
        EXECUTE replace(v_def, v_new, v_old);
      END
      $$;
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS public.cobranca_titulos_account_contact_numero_parcela_uniq;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS cobranca_titulos_account_contact_numero_uniq
        ON public.cobranca_titulos (account_id, contact_id, numero_titulo)
        WHERE numero_titulo IS NOT NULL;
    `);
  }
}
