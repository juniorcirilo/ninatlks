import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fonte de dados por agente: em vez de o cliente empurrar contatos no *nosso*
 * formato, ele diz de onde buscar e como ler a resposta dele.
 *
 * O que muda em relação ao recebimento por push que já existe: quem inicia a
 * chamada somos nós. O cliente configura url, token, método e o mapeamento
 * ("cliente_nome" da resposta dele vira nosso `name`), e o poller traduz e
 * grava usando o mesmo `ingest_agent_contact` do push — telefone como chave,
 * contato na lista operacional do agente, variáveis em `ingest_variables`.
 * Um único caminho de escrita, então as duas portas de entrada se comportam
 * igual.
 *
 * O token NÃO fica aqui: é credencial do sistema do cliente, mesma natureza do
 * auth token da Twilio, e vai para o vault (`account_secrets`, provider
 * `agent-source`, key_name = id desta linha) como todas as outras. A linha
 * guarda só o *nome do header* e o prefixo, que não são segredo e precisam ser
 * configuráveis — metade das APIs usa `Authorization: Bearer`, a outra metade
 * `x-api-key` pelado.
 *
 * `root_path` existe porque quase nenhuma API devolve o array na raiz: vem
 * `{"data":{"items":[…]}}`, e sem um caminho configurável o cliente teria que
 * pôr um n8n no meio só para desembrulhar — que é exatamente o que esta tela
 * quer evitar.
 *
 * RLS habilitada sem FORCE, como o resto do schema: o poller roda sem sessão
 * (é job de fila) e sob FORCE leria zero linhas e nunca buscaria nada, o
 * mesmo silêncio que já mordeu a chave de API e quase mordeu o dispatcher de
 * envio. A restrição a admin fica no RolesGuard e nas policies, que valem para
 * qualquer role que não seja o dono da tabela.
 */
export class AgentInboundSources20260731100000 implements MigrationInterface {
  name = 'AgentInboundSources20260731100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create table if not exists public.agent_inbound_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent_id uuid not null references public.agent_personas(id) on delete cascade,
  name text not null,
  url text not null,
  method text not null default 'GET',
  token_header text not null default 'Authorization',
  token_prefix text not null default 'Bearer ',
  body_template jsonb,
  root_path text,
  field_map jsonb not null default '{}'::jsonb,
  variables_map jsonb not null default '{}'::jsonb,
  list_key text,
  campaign_kind text,
  schedule_minutes integer,
  active boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_count integer,
  -- Trava de execução: o botão Sincronizar, o duplo clique nele e o poller
  -- disputam a mesma fonte. Sem trava, duas buscas simultâneas leem a mesma
  -- carga e gravam em paralelo — o upsert por telefone evita contato
  -- duplicado, mas não evita o trabalho dobrado nem o lote de aprovação
  -- criado duas vezes na campanha. Marca em vez de lock de sessão para
  -- sobreviver a mais de uma réplica da API.
  running_since timestamptz,
  created_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agent_inbound_sources_url_scheme check (url ~* '^https?://'),
  constraint agent_inbound_sources_method check (method in ('GET','POST')),
  -- Menos de 5 minutos vira martelo no ERP do cliente sem ganho nenhum: a
  -- carga que este poller lê muda em minutos, não em segundos.
  constraint agent_inbound_sources_schedule check (
    schedule_minutes is null or schedule_minutes >= 5)
);
`);
    await queryRunner.query(`
comment on column public.agent_inbound_sources.field_map is
  'Campo nosso -> chave na resposta do cliente. Ex.: {"name":"cliente_nome","phone":"cliente_fone"}. Aceita caminho com ponto.';
`);
    await queryRunner.query(`
comment on column public.agent_inbound_sources.variables_map is
  'Variável da fala -> chave na resposta. Ex.: {"valor":"valor_aberto"}. Vai para custom_attributes.ingest_variables.';
`);
    await queryRunner.query(`
comment on column public.agent_inbound_sources.schedule_minutes is
  'De quanto em quanto tempo buscar. NULL = só busca manual pelo botão.';
`);
    await queryRunner.query(`
create index if not exists agent_inbound_sources_account_idx
  on public.agent_inbound_sources(account_id, agent_id);
`);
    await queryRunner.query(`
create index if not exists agent_inbound_sources_due_idx
  on public.agent_inbound_sources(schedule_minutes, last_run_at)
  where active and schedule_minutes is not null;
`);

    await queryRunner.query(`
alter table public.agent_inbound_sources enable row level security;
`);
    for (const stmt of [
      `drop policy if exists "ais_select_admin" on public.agent_inbound_sources`,
      `drop policy if exists "ais_insert_admin" on public.agent_inbound_sources`,
      `drop policy if exists "ais_update_admin" on public.agent_inbound_sources`,
      `drop policy if exists "ais_delete_admin" on public.agent_inbound_sources`,
      `create policy "ais_select_admin" on public.agent_inbound_sources
         for select to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "ais_insert_admin" on public.agent_inbound_sources
         for insert to authenticated
         with check (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "ais_update_admin" on public.agent_inbound_sources
         for update to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
      `create policy "ais_delete_admin" on public.agent_inbound_sources
         for delete to authenticated
         using (has_role(auth.uid(), account_id, 'admin'::app_role))`,
    ]) {
      await queryRunner.query(stmt);
    }

    await queryRunner.query(`
drop trigger if exists set_agent_inbound_sources_updated_at on public.agent_inbound_sources;
`);
    await queryRunner.query(`
create trigger set_agent_inbound_sources_updated_at
  before update on public.agent_inbound_sources
  for each row execute function public.tg_set_updated_at();
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop table if exists public.agent_inbound_sources;`,
    );
  }
}
