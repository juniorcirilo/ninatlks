import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `account_webhook_endpoints` hoje é só por conta: um destino recebe todos os
 * agentes que casarem com `events`. Isso não serve o caso de "cada agente
 * dispara pro seu próprio n8n/CRM" — cobrança e SDR têm desfechos diferentes e
 * o cliente quer destinos (e segredos) separados por agente, configuráveis
 * pela tela, não amarrados no código.
 *
 * `agent_id` nulo preserva o comportamento atual (destino global, recebe
 * evento de qualquer agente) — migração aditiva, nenhum destino existente
 * muda de efeito. Cascade em agent_personas: agente excluído não deve deixar
 * destino órfão apontando pra um id que não existe mais.
 */
export class WebhookEndpointAgentScope20260731120000
  implements MigrationInterface
{
  name = 'WebhookEndpointAgentScope20260731120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.account_webhook_endpoints
  add column if not exists agent_id uuid references public.agent_personas(id) on delete cascade;
`);
    await queryRunner.query(`
comment on column public.account_webhook_endpoints.agent_id is
  'Agente ao qual este destino é restrito. NULL = destino global, recebe eventos de qualquer agente.';
`);
    // Índice único anterior era (account_id, url); com agent_id, o mesmo par
    // conta+url pode existir uma vez por agente (n8n do Diego != n8n da
    // Carla), então a unicidade precisa incluir a coluna nova.
    await queryRunner.query(`
drop index if exists public.account_webhook_endpoints_account_url_uniq;
`);
    await queryRunner.query(`
create unique index if not exists account_webhook_endpoints_account_agent_url_uniq
  on public.account_webhook_endpoints(account_id, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), url);
`);
    await queryRunner.query(`
create index if not exists account_webhook_endpoints_agent_idx
  on public.account_webhook_endpoints(agent_id) where agent_id is not null;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
drop index if exists public.account_webhook_endpoints_agent_idx;
`);
    await queryRunner.query(`
drop index if exists public.account_webhook_endpoints_account_agent_url_uniq;
`);
    await queryRunner.query(`
create unique index if not exists account_webhook_endpoints_account_url_uniq
  on public.account_webhook_endpoints(account_id, url);
`);
    await queryRunner.query(`
alter table public.account_webhook_endpoints drop column if exists agent_id;
`);
  }
}
