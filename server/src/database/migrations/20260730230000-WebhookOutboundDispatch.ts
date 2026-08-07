import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Destrava a leitura dos destinos de envio fora de uma requisição com sessão.
 *
 * `account_webhook_endpoints` nasceu com FORCE ROW LEVEL SECURITY, copiado de
 * `account_api_keys`. FORCE faz a RLS valer *também para o dono da tabela*, e o
 * dono é o mesmo role que a aplicação usa — então o dispatcher, que roda a
 * partir do fim de uma ligação (sem sessão, sem `app.current_user_id`), não
 * enxergaria destino nenhum: as policies exigem `has_role(auth.uid(), …)`. O
 * webhook simplesmente nunca sairia, sem erro nenhum. É o mesmo tropeço que
 * quebrou a autenticação por chave de API e que a
 * FixApiKeyGuardRls20260730210000 documenta.
 *
 * Aqui não dá para usar a saída de lá (policy casada com o hash do segredo que
 * o chamador já tem): o dispatcher não conhece nenhum segredo antes de ler a
 * linha — ler é justamente o que ele precisa fazer.
 *
 * Então a tabela passa a seguir a convenção do resto do schema (contacts,
 * accounts, agent_personas, contact_lists, webhook_deliveries: RLS habilitada,
 * sem FORCE): o dono passa direto, e a restrição "só admin administra destino"
 * continua valendo em dois lugares — RolesGuard('admin') no controller e as
 * policies, que seguem de pé para qualquer role que não seja o dono.
 */
export class WebhookOutboundDispatch20260730230000 implements MigrationInterface {
  name = 'WebhookOutboundDispatch20260730230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.account_webhook_endpoints no force row level security;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.account_webhook_endpoints force row level security;
`);
  }
}
