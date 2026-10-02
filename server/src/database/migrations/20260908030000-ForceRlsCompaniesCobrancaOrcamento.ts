import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `companies` (SchemaHardening 20260416210500) tem RLS habilitada mas sem
 * FORCE desde sempre — como o app conecta como `ninatlks_app`, dono da
 * tabela, "enable row level security" sozinho não restringia nada para ele
 * (só valeria para outro role hipotético). Isso permitiu o IDOR corrigido em
 * quotes.functions.ts/bruno.functions.ts/cobranca.functions.ts: qualquer
 * `createServerFn` do frontend (que roda sob o mesmo `ninatlks_app`, sem
 * nenhum contexto de sessão setado na conexão) podia ler/gravar
 * `companies`/`cobranca_titulos`/`orcamentos_erp` de qualquer conta só
 * confiando no `accountId` que o próprio client mandasse.
 *
 * `cobranca_titulos`/`orcamentos_erp` já nascem com FORCE nesta mesma
 * leva (ver 20260904010000-CobrancaOrcamentoTables.ts, migration ainda não
 * commitada — FORCE foi adicionado direto nela). Esta migration cobre só
 * `companies`, que já existia antes.
 *
 * Pré-requisito já resolvido: `ingest_agent_contact`/
 * `campaign_enroll_new_members` (as únicas funções que escrevem/leem essas
 * tabelas fora de uma sessão de usuário — chamadas via DataSource cru do
 * pipeline de ingest/campanha) ganharam `set row_security to off`, já que
 * fazem sua própria autorização por `_account_id`/`_campaign_id` passado
 * internamente pelo backend, nunca pelo client.
 *
 * Todo o resto que toca `companies` (CompaniesService, e as leituras de
 * cobranca-data.server.ts/quotes-data.server.ts no frontend) precisa rodar
 * com `app.current_user_id`/`app.current_account_id` setados na mesma
 * conexão — `tx.manager` já garante isso no backend; `queryAsAccount()`
 * (src/lib/db.ts) faz o equivalente no frontend.
 */
export class ForceRlsCompaniesCobrancaOrcamento20260908030000
  implements MigrationInterface
{
  name = 'ForceRlsCompaniesCobrancaOrcamento20260908030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.companies force row level security;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.companies no force row level security;
`);
  }
}
