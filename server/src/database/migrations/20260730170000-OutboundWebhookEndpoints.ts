import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Destinos de webhook de *envio* (produto → sistema do cliente).
 *
 * Até aqui a conta tinha um único `internal_attributes.webhookSecret` e nenhum
 * lugar para dizer *para onde* mandar. Um destino só não resolve o caso real:
 * o cliente costuma querer o desfecho da ligação no n8n e, em paralelo, a
 * reunião agendada no CRM — endpoints diferentes, com interesses diferentes.
 * Daí uma tabela em vez de mais um campo no JSON da conta.
 *
 * `secret` é por destino: quem recebe precisa validar a assinatura, e um
 * segredo compartilhado entre todos os destinos significa que revogar o do
 * parceiro que vazou derruba a integração de todos os outros.
 *
 * `events` vazio quer dizer "todos" — é o default menos surpreendente para
 * quem acabou de cadastrar e não quer entender o catálogo antes de testar.
 *
 * Única por (conta, url) porque os interesses moram na coluna `events` do
 * mesmo registro: a mesma URL duas vezes é erro de configuração, e o efeito
 * seria entrega dobrada.
 *
 * Só admin lê/escreve (mesma régua de `account_api_keys`): a linha guarda um
 * segredo e define para onde sai dado de cliente.
 */
export class OutboundWebhookEndpoints20260730170000
  implements MigrationInterface
{
  name = 'OutboundWebhookEndpoints20260730170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table if not exists public.account_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  url text not null,
  events text[] not null default array[]::text[],
  secret text not null,
  active boolean not null default true,
  created_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_webhook_endpoints_url_scheme check (url ~* '^https?://')
);
`);
    await queryRunner.query(`
comment on column public.account_webhook_endpoints.events is
  'Eventos assinados por este destino. Vazio = todos.';
`);
    await queryRunner.query(`
comment on column public.account_webhook_endpoints.secret is
  'Segredo HMAC SHA-256 deste destino, usado para assinar o payload enviado.';
`);
    await queryRunner.query(`
create unique index if not exists account_webhook_endpoints_account_url_uniq
  on public.account_webhook_endpoints(account_id, url);
`);
    await queryRunner.query(`
create index if not exists account_webhook_endpoints_account_idx
  on public.account_webhook_endpoints(account_id) where active;
`);

    await queryRunner.query(`
alter table public.account_webhook_endpoints enable row level security;
`);
    await queryRunner.query(`
alter table public.account_webhook_endpoints force row level security;
`);

    for (const stmt of [
      `drop policy if exists "awe_select_admin" on public.account_webhook_endpoints`,
      `drop policy if exists "awe_insert_admin" on public.account_webhook_endpoints`,
      `drop policy if exists "awe_update_admin" on public.account_webhook_endpoints`,
      `drop policy if exists "awe_delete_admin" on public.account_webhook_endpoints`,
      `create policy "awe_select_admin" on public.account_webhook_endpoints
         for select to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "awe_insert_admin" on public.account_webhook_endpoints
         for insert to authenticated
         with check (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "awe_update_admin" on public.account_webhook_endpoints
         for update to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "awe_delete_admin" on public.account_webhook_endpoints
         for delete to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
    ]) {
      await queryRunner.query(stmt);
    }

    await queryRunner.query(`
drop trigger if exists set_account_webhook_endpoints_updated_at on public.account_webhook_endpoints;
`);
    await queryRunner.query(`
create trigger set_account_webhook_endpoints_updated_at
  before update on public.account_webhook_endpoints
  for each row execute function public.tg_set_updated_at();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop table if exists public.account_webhook_endpoints;`,
    );
  }
}
