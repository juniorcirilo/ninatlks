import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Lista Operacional" por sincronização de cobrança/orçamento.
 *
 * Pedido: ao clicar em Sincronizar (manual, já que o auto-poll não tem
 * nenhuma fonte com `schedule_minutes` configurado hoje), os títulos/
 * orçamentos NOVOS daquela corrida (que ainda não estão em nenhuma lista
 * operacional em aberto) devem virar uma lista nova (`contact_lists`,
 * mesma entidade já usada em Configurações > Fontes de Dados > Listas
 * Operacionais e na tela /listas), nomeada "#<numero> <agente>". Títulos/
 * orçamentos que já estão numa lista não finalizada são deixados de lado —
 * já estão sendo trabalhados, sincronizar de novo não deve duplicá-los numa
 * lista nova.
 *
 * `status`/`list_number` ficam em `contact_lists` (não numa tabela nova):
 * é a mesma entidade que já aparece em /listas, só ganhando os dois campos
 * que faltavam para dar suporte ao ciclo aberta→finalizada. Lista criada
 * manualmente (fora deste fluxo) nasce 'aberta' por padrão e nunca precisa
 * ser finalizada — o campo só importa pra quem usa o fluxo de sync.
 */
export class OperationalListSyncRun20260923010000
  implements MigrationInterface
{
  name = 'OperationalListSyncRun20260923010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create sequence if not exists public.contact_lists_number_seq
  start with 100001;
`);

    await queryRunner.query(`
alter table public.contact_lists
  add column if not exists status text not null default 'aberta'
    check (status in ('aberta', 'finalizada')),
  add column if not exists list_number bigint,
  add column if not exists finalized_at timestamptz;
`);

    await queryRunner.query(`
alter table public.cobranca_titulos
  add column if not exists operational_list_id uuid
    references public.contact_lists(id) on delete set null;
`);
    await queryRunner.query(`
create index if not exists cobranca_titulos_operational_list_idx
  on public.cobranca_titulos(operational_list_id);
`);

    await queryRunner.query(`
alter table public.orcamentos_erp
  add column if not exists operational_list_id uuid
    references public.contact_lists(id) on delete set null;
`);
    await queryRunner.query(`
create index if not exists orcamentos_erp_operational_list_idx
  on public.orcamentos_erp(operational_list_id);
`);

    // `set row_security to off`: mesmo motivo de ingest_agent_contact
    // (20260904010000-CobrancaOrcamentoTables.ts) — chamada pelo pipeline de
    // sync (agent-sources.service.ts), sem sessão de usuário.
    await queryRunner.query(`
create or replace function public.sync_operational_list(
  _account_id uuid,
  _agent_persona_id uuid,
  _document_kind text,
  _run_started_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_persona_name text;
  v_candidate_ids uuid[];
  v_contact_ids uuid[];
  v_list_id uuid;
  v_list_number bigint;
  v_list_name text;
  v_count int;
begin
  if _document_kind not in ('cobranca', 'orcamento') then
    return jsonb_build_object('created', false, 'itemCount', 0);
  end if;

  select name into v_persona_name
    from public.agent_personas
   where id = _agent_persona_id and account_id = _account_id;

  if _document_kind = 'cobranca' then
    select coalesce(array_agg(t.id), array[]::uuid[]),
           coalesce(array_agg(distinct t.contact_id), array[]::uuid[])
      into v_candidate_ids, v_contact_ids
      from public.cobranca_titulos t
     where t.account_id = _account_id
       and t.persona_id = _agent_persona_id
       and t.updated_at >= _run_started_at
       and (t.operational_list_id is null
            or exists (
                 select 1 from public.contact_lists l
                  where l.id = t.operational_list_id and l.status = 'finalizada'
               ));
  else
    select coalesce(array_agg(o.id), array[]::uuid[]),
           coalesce(array_agg(distinct o.contact_id), array[]::uuid[])
      into v_candidate_ids, v_contact_ids
      from public.orcamentos_erp o
     where o.account_id = _account_id
       and o.persona_id = _agent_persona_id
       and o.updated_at >= _run_started_at
       and (o.operational_list_id is null
            or exists (
                 select 1 from public.contact_lists l
                  where l.id = o.operational_list_id and l.status = 'finalizada'
               ));
  end if;

  v_count := array_length(v_candidate_ids, 1);
  if v_count is null or v_count = 0 then
    return jsonb_build_object('created', false, 'itemCount', 0);
  end if;

  v_list_number := nextval('public.contact_lists_number_seq');
  v_list_name := '#' || v_list_number || ' ' || coalesce(v_persona_name, 'Agente');

  insert into public.contact_lists
    (account_id, name, description, persona_id, status, list_number)
  values
    (_account_id, v_list_name,
     'Lista operacional gerada por sincronização de '
       || case when _document_kind = 'cobranca' then 'cobrança' else 'orçamento' end,
     _agent_persona_id, 'aberta', v_list_number)
  returning id into v_list_id;

  if _document_kind = 'cobranca' then
    update public.cobranca_titulos
       set operational_list_id = v_list_id
     where id = any(v_candidate_ids);
  else
    update public.orcamentos_erp
       set operational_list_id = v_list_id
     where id = any(v_candidate_ids);
  end if;

  insert into public.contact_list_members (list_id, contact_id, account_id)
  select v_list_id, c, _account_id from unnest(v_contact_ids) as c
  on conflict (list_id, contact_id) do nothing;

  update public.contact_lists
     set member_count = (
           select count(*) from public.contact_list_members where list_id = v_list_id
         ),
         updated_at = now()
   where id = v_list_id;

  return jsonb_build_object(
    'created', true,
    'listId', v_list_id,
    'listName', v_list_name,
    'itemCount', v_count
  );
end;
$function$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.sync_operational_list(uuid, uuid, text, timestamptz);`,
    );
    await queryRunner.query(
      `drop index if exists public.orcamentos_erp_operational_list_idx;`,
    );
    await queryRunner.query(
      `alter table public.orcamentos_erp drop column if exists operational_list_id;`,
    );
    await queryRunner.query(
      `drop index if exists public.cobranca_titulos_operational_list_idx;`,
    );
    await queryRunner.query(
      `alter table public.cobranca_titulos drop column if exists operational_list_id;`,
    );
    await queryRunner.query(`
alter table public.contact_lists
  drop column if exists finalized_at,
  drop column if exists list_number,
  drop column if exists status;
`);
    await queryRunner.query(`drop sequence if exists public.contact_lists_number_seq;`);
  }
}
