import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O envio de saída sempre foi POST fixo (`webhook-delivery.processor.ts`).
 * Não serve o webhook de agente por n8n: o nó Webhook criado por
 * `N8nIntegrationService`/`N8N_HTTP_METHOD` no lado de *entrada* é GET por
 * padrão (ver .env), e é comum o cliente reaproveitar o mesmo nó/URL como
 * destino de *saída* — POST nele vira 404/405 no n8n, que só aceita o método
 * com que o nó foi criado. `method` por destino resolve sem exigir que o
 * cliente crie um segundo nó só pra aceitar POST.
 */
export class WebhookEndpointMethod20260731130000
  implements MigrationInterface
{
  name = 'WebhookEndpointMethod20260731130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.account_webhook_endpoints
  add column if not exists method text not null default 'POST';
`);
    await queryRunner.query(`
alter table public.account_webhook_endpoints
  add constraint account_webhook_endpoints_method_check check (method in ('GET','POST'));
`);
    await queryRunner.query(`
comment on column public.account_webhook_endpoints.method is
  'Método HTTP usado para entregar este destino. GET manda o payload em ?payload= (querystring) em vez do corpo.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.account_webhook_endpoints
  drop constraint if exists account_webhook_endpoints_method_check;
`);
    await queryRunner.query(`
alter table public.account_webhook_endpoints drop column if exists method;
`);
  }
}
