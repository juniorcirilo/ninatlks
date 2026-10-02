import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * REVERT DE EMERGÊNCIA: `FORCE ROW LEVEL SECURITY` em companies/
 * cobranca_titulos/orcamentos_erp (20260904010000 + 20260908030000/040000)
 * quebrou a ingestão de produção.
 *
 * Descoberta em teste (transação com ROLLBACK, sem afetar dados reais):
 * `SET row_security TO off` dentro de uma função SECURITY DEFINER NÃO
 * contorna FORCE ROW LEVEL SECURITY. Para uma tabela com FORCE, o Postgres
 * não aplica a policy silenciosamente nesse modo — ele RECUSA a query com
 * "query would be affected by row-level security policy... To disable the
 * policy for the table's owner, use ALTER TABLE NO FORCE ROW LEVEL
 * SECURITY". `row_security = off` só de fato ignora RLS quando a tabela
 * NÃO tem FORCE (aí o dono já bypassa por padrão) — nesse caso o efeito
 * prático dele é zero. Com FORCE, o efeito é o oposto do pretendido: toda
 * chamada de `ingest_agent_contact` que tocasse `companies` (SELECT ou
 * INSERT/UPDATE, com externalId OU com o novo companyId manual) lançava
 * exceção e abortava a função inteira — nem o contato era criado.
 *
 * Fix correto para FORCE RLS funcionar de verdade nas queries cruas do
 * frontend (src/lib/db.ts) exigiria uma role de Postgres separada, sem
 * ownership da tabela, só para essas conexões — `ninatlks_app` é dono das
 * tabelas, e é o mesmo role usado por TODOS os caminhos (backend
 * autenticado via TenantTxHost/GUCs, ingest sem sessão, e o pool cru do
 * frontend). Isso é uma mudança de infraestrutura maior (provisionar role,
 * credenciais, atualizar DATABASE_URL do frontend) — fora do escopo deste
 * revert emergencial. Até lá, a proteção contra os IDOR corrigidos nesta
 * mesma sessão (quotes/bruno/cobranca/admin-queues .functions.ts) continua
 * de pé via `context.accountId` no código da aplicação — só a camada
 * extra de enforcement no banco (FORCE) é que sai.
 */
export class RevertForceRlsIngestBroken20260908060000
  implements MigrationInterface
{
  name = 'RevertForceRlsIngestBroken20260908060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.companies no force row level security;
`);
    await queryRunner.query(`
alter table public.cobranca_titulos no force row level security;
`);
    await queryRunner.query(`
alter table public.orcamentos_erp no force row level security;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.companies force row level security;
`);
    await queryRunner.query(`
alter table public.cobranca_titulos force row level security;
`);
    await queryRunner.query(`
alter table public.orcamentos_erp force row level security;
`);
  }
}
