import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas dedicadas para os documentos ERP que hoje só existem dentro de
 * `contacts.custom_attributes.ingest_variables` (um JSONB genérico por
 * contato, que só guarda o último valor por chave): `cobranca_titulos`
 * (títulos em aberto do Diego Cobrança) e `orcamentos_erp` (orçamentos do
 * Bruno vindos do ERP — não confundir com `public.quotes`, que é o orçamento
 * gerado em chat).
 *
 * Motivo: um cliente com N títulos em aberto ao mesmo tempo colapsava pra 1
 * só no JSONB (a última carga processada vencia a sobrescrita) — caso real
 * documentado em `agent-sources.service.ts` (cliente com 46 títulos virando
 * 1, e justamente o menos urgente). Uma linha por título/orçamento resolve
 * isso: `ingest_agent_contact` passa a fazer upsert em `cobranca_titulos`/
 * `orcamentos_erp` chaveado por (contact_id, numero_titulo/numero_orcamento)
 * em vez de sobrescrever um único blob por contato — e o upsert roda sempre,
 * mesmo quando o agente está em `ingest_mode = 'insert'` (que só trava
 * nome/telefone/email do contato, nunca os dados do documento ERP).
 *
 * `custom_attributes.ingest_variables` continua sendo gravado do mesmo jeito
 * (não é removido) — é o mecanismo genérico usado por campanhas que não são
 * cobrança/orçamento (sdr, pos_venda, retenção, custom), e essas não ganham
 * tabela dedicada aqui.
 */
export class CobrancaOrcamentoTables20260904010000
  implements MigrationInterface
{
  name = 'CobrancaOrcamentoTables20260904010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Tabelas ──────────────────────────────────────────────────────────
    await queryRunner.query(`
create table if not exists public.cobranca_titulos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  persona_id uuid references public.agent_personas(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  numero_titulo text,
  numero_pedido text,
  parcela text,
  data_emissao text,
  data_vencimento text,
  dias_em_atraso integer,
  valor_original_parcela numeric(12,2),
  valor_ja_pago numeric(12,2),
  valor_devedor_saldo numeric(12,2),
  status_titulo text,
  raw_variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
comment on table public.cobranca_titulos is
  'Títulos em aberto do agente Diego Cobrança, vindos do ERP via ingest_agent_contact. Uma linha por título — um cliente pode ter vários.';
`);
    await queryRunner.query(`
create unique index if not exists cobranca_titulos_account_contact_numero_uniq
  on public.cobranca_titulos(account_id, contact_id, numero_titulo)
  where numero_titulo is not null;
`);
    await queryRunner.query(`
create index if not exists idx_cobranca_titulos_account_contact
  on public.cobranca_titulos(account_id, contact_id);
`);
    await queryRunner.query(`
create index if not exists idx_cobranca_titulos_account_atraso
  on public.cobranca_titulos(account_id, dias_em_atraso desc nulls last);
`);
    await queryRunner.query(`
alter table public.cobranca_titulos enable row level security;
`);
    // FORCE: sem isto, "enable row level security" sozinho não restringe o
    // dono da tabela (o papel de conexão do app, ninatlks_app) — as policies
    // abaixo só valeriam pra outros roles. Dado financeiro sensível (saldo
    // devedor de cliente) — exige enforcement de verdade, não só decorativo.
    await queryRunner.query(`
alter table public.cobranca_titulos force row level security;
`);
    await queryRunner.query(`
create policy "cobranca_titulos_select_member" on public.cobranca_titulos
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "cobranca_titulos_write_member" on public.cobranca_titulos
  for all to authenticated
  using (is_account_member(auth.uid(), account_id))
  with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create trigger set_cobranca_titulos_updated_at before update on public.cobranca_titulos
  for each row execute function public.tg_set_updated_at();
`);

    await queryRunner.query(`
create table if not exists public.orcamentos_erp (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  persona_id uuid references public.agent_personas(id) on delete set null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  numero_orcamento text,
  pedido_cliente text,
  valor_total numeric(12,2),
  data_emissao text,
  data_previsao text,
  status_orcamento text,
  raw_variables jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
`);
    await queryRunner.query(`
comment on table public.orcamentos_erp is
  'Orçamentos do agente Bruno vindos do ERP via ingest_agent_contact. Uma linha por orçamento — diferente de public.quotes (orçamento gerado em chat).';
`);
    await queryRunner.query(`
create unique index if not exists orcamentos_erp_account_contact_numero_uniq
  on public.orcamentos_erp(account_id, contact_id, numero_orcamento)
  where numero_orcamento is not null;
`);
    await queryRunner.query(`
create index if not exists idx_orcamentos_erp_account_contact
  on public.orcamentos_erp(account_id, contact_id);
`);
    await queryRunner.query(`
create index if not exists idx_orcamentos_erp_account_created
  on public.orcamentos_erp(account_id, created_at desc);
`);
    await queryRunner.query(`
alter table public.orcamentos_erp enable row level security;
`);
    await queryRunner.query(`
alter table public.orcamentos_erp force row level security;
`);
    await queryRunner.query(`
create policy "orcamentos_erp_select_member" on public.orcamentos_erp
  for select to authenticated using (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create policy "orcamentos_erp_write_member" on public.orcamentos_erp
  for all to authenticated
  using (is_account_member(auth.uid(), account_id))
  with check (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
create trigger set_orcamentos_erp_updated_at before update on public.orcamentos_erp
  for each row execute function public.tg_set_updated_at();
`);

    // ── Backfill: preserva o que já existe hoje em ingest_variables ────────
    await queryRunner.query(`
with src as (
  select l.account_id, p.id as persona_id, c.id as contact_id,
         coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb) as v
    from public.contact_lists l
    join public.contact_list_members m on m.list_id = l.id
    join public.contacts c on c.id = m.contact_id
    join public.agent_personas p on p.account_id = l.account_id and p.name = 'Diego Cobrança'
   where l.external_key = 'agent:' || p.id::text
     and c.deleted_at is null
)
insert into public.cobranca_titulos (
  account_id, persona_id, contact_id, numero_titulo, numero_pedido, parcela,
  data_emissao, data_vencimento, dias_em_atraso, valor_original_parcela,
  valor_ja_pago, valor_devedor_saldo, status_titulo, raw_variables
)
select account_id, persona_id, contact_id,
       nullif(v ->> 'numero_titulo', ''),
       nullif(v ->> 'numero_pedido', ''),
       nullif(v ->> 'parcela', ''),
       nullif(v ->> 'data_emissao', ''),
       nullif(v ->> 'data_vencimento', ''),
       case when v ->> 'dias_em_atraso' ~ '^-?[0-9]+$' then (v ->> 'dias_em_atraso')::int else null end,
       case when v ->> 'valor_original_parcela' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v ->> 'valor_original_parcela')::numeric else null end,
       case when v ->> 'valor_ja_pago' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v ->> 'valor_ja_pago')::numeric else null end,
       case when v ->> 'valor_devedor_saldo' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v ->> 'valor_devedor_saldo')::numeric else null end,
       nullif(v ->> 'status_titulo', ''),
       v
  from src
on conflict (account_id, contact_id, numero_titulo) where numero_titulo is not null do nothing;
`);
    await queryRunner.query(`
with src as (
  select l.account_id, p.id as persona_id, c.id as contact_id,
         coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb) as v
    from public.contact_lists l
    join public.contact_list_members m on m.list_id = l.id
    join public.contacts c on c.id = m.contact_id
    join public.agent_personas p on p.account_id = l.account_id and p.name = 'Bruno'
   where l.external_key = 'agent:' || p.id::text
     and c.deleted_at is null
)
insert into public.orcamentos_erp (
  account_id, persona_id, contact_id, numero_orcamento, pedido_cliente,
  valor_total, data_emissao, data_previsao, status_orcamento, raw_variables
)
select account_id, persona_id, contact_id,
       nullif(v ->> 'numero_orcamento', ''),
       nullif(v ->> 'pedido_cliente', ''),
       case when v ->> 'valor_total' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v ->> 'valor_total')::numeric else null end,
       nullif(v ->> 'data_emissao', ''),
       nullif(v ->> 'data_previsao', ''),
       nullif(v ->> 'status_orcamento', ''),
       v
  from src
on conflict (account_id, contact_id, numero_orcamento) where numero_orcamento is not null do nothing;
`);

    // ── Função auxiliar: variáveis de fala enriquecidas com o documento ERP
    // estruturado, pra alimentar voice_campaign_contacts.variables nos 3
    // pontos que hoje só leem custom_attributes.ingest_variables. Quando o
    // contato tem múltiplos títulos em aberto, usa o mais atrasado (maior
    // dias_em_atraso) — é o que importa pra uma ligação de cobrança.
    await queryRunner.query(`
create or replace function public.contact_erp_variables(_contact_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb)
    || coalesce((
         select jsonb_build_object(
           'numero_titulo', t.numero_titulo, 'numero_pedido', t.numero_pedido,
           'parcela', t.parcela, 'data_emissao', t.data_emissao,
           'data_vencimento', t.data_vencimento, 'dias_em_atraso', t.dias_em_atraso,
           'valor_original_parcela', t.valor_original_parcela,
           'valor_ja_pago', t.valor_ja_pago, 'valor_devedor_saldo', t.valor_devedor_saldo,
           'status_titulo', t.status_titulo)
           from public.cobranca_titulos t
          where t.contact_id = _contact_id
          order by t.dias_em_atraso desc nulls last
          limit 1
       ), '{}'::jsonb)
    || coalesce((
         select jsonb_build_object(
           'numero_orcamento', o.numero_orcamento, 'pedido_cliente', o.pedido_cliente,
           'valor_total', o.valor_total, 'data_emissao', o.data_emissao,
           'data_previsao', o.data_previsao, 'status_orcamento', o.status_orcamento)
           from public.orcamentos_erp o
          where o.contact_id = _contact_id
          order by o.created_at desc
          limit 1
       ), '{}'::jsonb)
    from public.contacts c
   where c.id = _contact_id;
$function$;
`);

    // ── document_kind: identifica de forma estável (não pelo nome livre da
    // persona, que qualquer admin pode editar em Configurações > Agentes)
    // se um agente é o de cobrança ou o de orçamento — usado logo abaixo
    // por ingest_agent_contact para decidir se grava em cobranca_titulos ou
    // orcamentos_erp. Renomear a persona não quebra mais essa gravação.
    await queryRunner.query(`
alter table public.agent_personas
  add column if not exists document_kind text
  check (document_kind in ('cobranca', 'orcamento'));
`);
    await queryRunner.query(`
comment on column public.agent_personas.document_kind is
  'Tipo de documento ERP que este agente grava via ingest_agent_contact: cobranca -> cobranca_titulos, orcamento -> orcamentos_erp, null -> nenhum. Não é o mesmo que agent_roles.kind (papel operacional).';
`);
    await queryRunner.query(`
update public.agent_personas set document_kind = 'cobranca'
 where name = 'Diego Cobrança' and document_kind is null;
`);
    await queryRunner.query(`
update public.agent_personas set document_kind = 'orcamento'
 where name = 'Bruno' and document_kind is null;
`);

    // ── ingest_agent_contact: além do que já fazia (lista, contato, empresa),
    // agora também mantém cobranca_titulos/orcamentos_erp em dia — upsert
    // incondicional, desacoplado do ingest_mode do agente (que só controla
    // nome/telefone/email do contato).
    //
    // `set row_security to off`: esta função é chamada pelo pipeline de
    // ingest (webhook/n8n → agent-sources.service.ts → ingest.service.ts),
    // sem sessão de usuário — app.current_user_id/auth.uid() nunca estão
    // setados nessa conexão. companies/cobranca_titulos/orcamentos_erp têm
    // FORCE ROW LEVEL SECURITY (dado sensível), o que faria a policy
    // is_account_member(auth.uid(), account_id) negar toda escrita aqui
    // mesmo sendo SECURITY DEFINER. A função já faz sua própria autorização
    // via _account_id (parâmetro de dentro do próprio backend, nunca do
    // client), então desligar row_security dentro dela é seguro e
    // necessário — mesmo padrão de call_attempt_log_insert
    // (20260720230000-CallAttemptsLogInsertBypass.ts).
    await queryRunner.query(`
create or replace function public.ingest_agent_contact(_account_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_agent text := nullif(_payload ->> 'agent', '');
  v_phone text := nullif(_payload ->> 'phone', '');
  v_name text := nullif(_payload ->> 'name', '');
  v_email text := nullif(_payload ->> 'email', '');
  v_external_id text := nullif(_payload ->> 'externalId', '');
  v_razao_social text := nullif(_payload ->> 'razaoSocial', '');
  v_nome_fantasia text := nullif(_payload ->> 'nomeFantasia', '');
  v_vendedor_nome text := nullif(_payload ->> 'vendedorNome', '');
  v_vars jsonb := coalesce(_payload -> 'variables', '{}'::jsonb);
  v_list_key text := coalesce(nullif(_payload ->> 'listKey', ''), 'agent:' || v_agent);
  v_list_name_explicit text := nullif(_payload ->> 'listName', '');
  v_list_name_default text := coalesce(
    nullif(_payload ->> 'defaultListName', ''), 'Agente ' || v_agent);
  v_kind text := nullif(_payload ->> 'campaignKind', '');
  v_list_id uuid;
  v_contact_id uuid;
  v_contact_deleted_at timestamptz;
  v_email_taken boolean := false;
  v_identifier text;
  v_company_id uuid;
  v_vendedor_id uuid;
  v_vendedor_match_count int;
  v_ingest_mode text;
  v_document_kind text;
  v_skipped boolean := false;
  v_reason text;
  v_created boolean := false;
begin
  if v_agent is null then
    raise exception 'agent é obrigatório' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'phone é obrigatório' using errcode = '22023';
  end if;
  if v_phone !~ '^\\+[1-9][0-9]{7,14}$' then
    raise exception 'phone deve estar em E.164 (ex.: +5511999998888), recebido: %', v_phone
      using errcode = '22023';
  end if;

  select coalesce(ingest_mode, 'insert'), document_kind into v_ingest_mode, v_document_kind
    from public.agent_personas
   where id::text = v_agent and account_id = _account_id;
  v_ingest_mode := coalesce(v_ingest_mode, 'insert');

  insert into public.contact_lists (account_id, name, external_key, campaign_kind, description)
  values (_account_id, coalesce(v_list_name_explicit, v_list_name_default),
          v_list_key, v_kind,
          'Lista operacional recebida por webhook de integração')
  on conflict (account_id, external_key) where external_key is not null
  do update set name = coalesce(v_list_name_explicit, contact_lists.name),
                campaign_kind = coalesce(excluded.campaign_kind, contact_lists.campaign_kind),
                updated_at = now()
  returning id into v_list_id;

  select id, deleted_at into v_contact_id, v_contact_deleted_at
    from public.contacts
   where account_id = _account_id and phone_number = v_phone
   order by created_at asc
   limit 1;

  if v_contact_id is null then
    v_identifier := 'phone:' || substring(v_phone from 2);
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and identifier = v_identifier
     limit 1;
  end if;

  if v_contact_id is null and v_external_id is not null then
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and external_id = v_external_id
     limit 1;
  end if;

  if v_external_id is not null then
    select id into v_company_id
      from public.companies
     where account_id = _account_id and external_id = v_external_id;

    if v_company_id is null then
      insert into public.companies (account_id, name, razao_social, nome_fantasia, external_id)
      values (_account_id, coalesce(v_razao_social, v_nome_fantasia, v_name, 'Cliente ' || v_external_id),
              v_razao_social, v_nome_fantasia, v_external_id)
      returning id into v_company_id;
    else
      update public.companies
         set razao_social = coalesce(razao_social, v_razao_social),
             nome_fantasia = coalesce(nome_fantasia, v_nome_fantasia),
             updated_at = now()
       where id = v_company_id
         and (razao_social is null and v_razao_social is not null
              or nome_fantasia is null and v_nome_fantasia is not null);
    end if;

    if v_vendedor_nome is not null then
      select count(*), (array_agg(au.user_id))[1]
        into v_vendedor_match_count, v_vendedor_id
        from public.account_users au
        join public.profiles p on p.id = au.user_id
       where au.account_id = _account_id
         and lower(coalesce(p.display_name, p.name, '')) = lower(v_vendedor_nome);

      if v_vendedor_match_count = 1 then
        update public.companies set vendedor_id = v_vendedor_id, updated_at = now()
         where id = v_company_id and vendedor_id is null;
      else
        update public.companies set vendedor_nome_erp = v_vendedor_nome, updated_at = now()
         where id = v_company_id and vendedor_id is null and vendedor_nome_erp is null;
      end if;
    end if;
  end if;

  if v_contact_id is not null and v_contact_deleted_at is not null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'contato removido anteriormente; integração não recria',
      'contactId', v_contact_id,
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
  end if;

  if v_email is not null then
    select exists (
      select 1 from public.contacts
       where account_id = _account_id and email = v_email
         and (v_contact_id is null or id <> v_contact_id)
    ) into v_email_taken;
  end if;

  if v_contact_id is not null then
    if v_ingest_mode = 'insert' then
      v_skipped := true;
      v_reason := 'contato já existe; integração só insere, não atualiza';
    else
      update public.contacts c
         set name = coalesce(v_name, c.name),
             phone_number = v_phone,
             email = case when v_email is null or v_email_taken then c.email else v_email end,
             external_id = coalesce(c.external_id, v_external_id),
             company_id = coalesce(c.company_id, v_company_id),
             custom_attributes = coalesce(c.custom_attributes, '{}'::jsonb)
               || jsonb_build_object(
                    'agent_key', v_agent,
                    'ingest_variables',
                      coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb) || v_vars
                  ),
             last_activity_at = now(),
             updated_at = now()
       where c.id = v_contact_id;
    end if;

    insert into public.contact_list_members (list_id, contact_id, account_id)
    values (v_list_id, v_contact_id, _account_id)
    on conflict (list_id, contact_id) do nothing;

    update public.contact_lists
       set member_count = (select count(*) from public.contact_list_members
                            where list_id = v_list_id),
           updated_at = now()
     where id = v_list_id;
  else
    insert into public.contacts
      (account_id, name, phone_number, email, identifier, external_id, company_id, source,
       custom_attributes, last_activity_at)
    values
      (_account_id, v_name, v_phone,
       case when v_email_taken then null else v_email end,
       'phone:' || substring(v_phone from 2), v_external_id, v_company_id, 'inbound',
       jsonb_build_object('agent_key', v_agent, 'ingest_variables', v_vars),
       now())
    on conflict (account_id, identifier) where identifier is not null
    do nothing
    returning id into v_contact_id;

    if v_contact_id is null then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'contato já existe; integração só insere, não atualiza',
        'listId', v_list_id,
        'listKey', v_list_key,
        'phone', v_phone
      );
    end if;

    v_created := true;

    insert into public.contact_list_members (list_id, contact_id, account_id)
    values (v_list_id, v_contact_id, _account_id)
    on conflict (list_id, contact_id) do nothing;

    update public.contact_lists
       set member_count = (select count(*) from public.contact_list_members
                            where list_id = v_list_id),
           updated_at = now()
     where id = v_list_id;
  end if;

  -- Documento ERP estruturado: roda sempre (independente de skip/insert_mode)
  -- — o que o ingest_mode do agente trava é só nome/telefone/email do
  -- contato, nunca a atualidade do título/orçamento em si.
  if v_document_kind = 'cobranca' then
    insert into public.cobranca_titulos (
      account_id, persona_id, contact_id, numero_titulo, numero_pedido, parcela,
      data_emissao, data_vencimento, dias_em_atraso, valor_original_parcela,
      valor_ja_pago, valor_devedor_saldo, status_titulo, raw_variables
    )
    values (
      _account_id, v_agent::uuid, v_contact_id,
      nullif(v_vars ->> 'numero_titulo', ''),
      nullif(v_vars ->> 'numero_pedido', ''),
      nullif(v_vars ->> 'parcela', ''),
      nullif(v_vars ->> 'data_emissao', ''),
      nullif(v_vars ->> 'data_vencimento', ''),
      case when v_vars ->> 'dias_em_atraso' ~ '^-?[0-9]+$' then (v_vars ->> 'dias_em_atraso')::int else null end,
      case when v_vars ->> 'valor_original_parcela' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v_vars ->> 'valor_original_parcela')::numeric else null end,
      case when v_vars ->> 'valor_ja_pago' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v_vars ->> 'valor_ja_pago')::numeric else null end,
      case when v_vars ->> 'valor_devedor_saldo' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v_vars ->> 'valor_devedor_saldo')::numeric else null end,
      nullif(v_vars ->> 'status_titulo', ''),
      v_vars
    )
    on conflict (account_id, contact_id, numero_titulo) where numero_titulo is not null
    do update set
      numero_pedido = excluded.numero_pedido,
      parcela = excluded.parcela,
      data_emissao = excluded.data_emissao,
      data_vencimento = excluded.data_vencimento,
      dias_em_atraso = excluded.dias_em_atraso,
      valor_original_parcela = excluded.valor_original_parcela,
      valor_ja_pago = excluded.valor_ja_pago,
      valor_devedor_saldo = excluded.valor_devedor_saldo,
      status_titulo = excluded.status_titulo,
      raw_variables = excluded.raw_variables,
      updated_at = now();
  elsif v_document_kind = 'orcamento' then
    insert into public.orcamentos_erp (
      account_id, persona_id, contact_id, numero_orcamento, pedido_cliente,
      valor_total, data_emissao, data_previsao, status_orcamento, raw_variables
    )
    values (
      _account_id, v_agent::uuid, v_contact_id,
      nullif(v_vars ->> 'numero_orcamento', ''),
      nullif(v_vars ->> 'pedido_cliente', ''),
      case when v_vars ->> 'valor_total' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (v_vars ->> 'valor_total')::numeric else null end,
      nullif(v_vars ->> 'data_emissao', ''),
      nullif(v_vars ->> 'data_previsao', ''),
      nullif(v_vars ->> 'status_orcamento', ''),
      v_vars
    )
    on conflict (account_id, contact_id, numero_orcamento) where numero_orcamento is not null
    do update set
      pedido_cliente = excluded.pedido_cliente,
      valor_total = excluded.valor_total,
      data_emissao = excluded.data_emissao,
      data_previsao = excluded.data_previsao,
      status_orcamento = excluded.status_orcamento,
      raw_variables = excluded.raw_variables,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'skipped', v_skipped,
    'reason', v_reason,
    'contactId', v_contact_id,
    'created', v_created,
    'listId', v_list_id,
    'listKey', v_list_key,
    'phone', v_phone
  );
end;
$function$;
`);

    // ── campaign_enroll_new_members: mesma enriquecimento na variável que
    // vai pro voice_campaign_contacts (chamado pelo auto-enroll de campanha
    // viva quando a ingestão traz gente nova).
    await queryRunner.query(`
create or replace function public.campaign_enroll_new_members(
  _campaign_id uuid,
  _source text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_campaign public.voice_campaigns%rowtype;
  v_batch_id uuid;
  v_count int;
begin
  select * into v_campaign from public.voice_campaigns where id = _campaign_id;
  if not found then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_not_found');
  end if;
  if v_campaign.auto_enroll_mode <> 'approval' or v_campaign.source_list_id is null then
    return jsonb_build_object('enrolled', 0, 'reason', 'auto_enroll_off');
  end if;
  if v_campaign.status in ('canceled','cancelled','failed') then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_closed');
  end if;

  insert into public.campaign_enrollment_batches
    (account_id, campaign_id, list_id, contact_count, source)
  values (v_campaign.account_id, _campaign_id, v_campaign.source_list_id, 0, _source)
  returning id into v_batch_id;

  with inserted as (
    insert into public.voice_campaign_contacts
      (account_id, campaign_id, contact_id, to_number, phone_number, status,
       variables, enrollment_batch_id)
    select v_campaign.account_id, _campaign_id, c.id, c.phone_number,
           c.phone_number, 'pending_approval',
           public.contact_erp_variables(c.id),
           v_batch_id
      from public.contact_list_members clm
      join public.contacts c on c.id = clm.contact_id
     where clm.list_id = v_campaign.source_list_id
       and c.deleted_at is null
       and c.blocked = false
       and c.phone_number is not null
       and not exists (
         select 1 from public.voice_campaign_contacts vcc
          where vcc.campaign_id = _campaign_id
            and vcc.contact_id = c.id
       )
    returning 1
  )
  select count(*) into v_count from inserted;

  if v_count = 0 then
    delete from public.campaign_enrollment_batches where id = v_batch_id;
    return jsonb_build_object('enrolled', 0, 'reason', 'no_new_members');
  end if;

  update public.campaign_enrollment_batches
     set contact_count = v_count where id = v_batch_id;

  return jsonb_build_object('enrolled', v_count, 'batchId', v_batch_id);
end;
$function$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura campaign_enroll_new_members pra versão anterior (sem o
    // enriquecimento — lê só ingest_variables, como em CampaignBatchEnrollment).
    await queryRunner.query(`
create or replace function public.campaign_enroll_new_members(
  _campaign_id uuid,
  _source text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_campaign public.voice_campaigns%rowtype;
  v_batch_id uuid;
  v_count int;
begin
  select * into v_campaign from public.voice_campaigns where id = _campaign_id;
  if not found then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_not_found');
  end if;
  if v_campaign.auto_enroll_mode <> 'approval' or v_campaign.source_list_id is null then
    return jsonb_build_object('enrolled', 0, 'reason', 'auto_enroll_off');
  end if;
  if v_campaign.status in ('canceled','cancelled','failed') then
    return jsonb_build_object('enrolled', 0, 'reason', 'campaign_closed');
  end if;

  insert into public.campaign_enrollment_batches
    (account_id, campaign_id, list_id, contact_count, source)
  values (v_campaign.account_id, _campaign_id, v_campaign.source_list_id, 0, _source)
  returning id into v_batch_id;

  with inserted as (
    insert into public.voice_campaign_contacts
      (account_id, campaign_id, contact_id, to_number, phone_number, status,
       variables, enrollment_batch_id)
    select v_campaign.account_id, _campaign_id, c.id, c.phone_number,
           c.phone_number, 'pending_approval',
           coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb),
           v_batch_id
      from public.contact_list_members clm
      join public.contacts c on c.id = clm.contact_id
     where clm.list_id = v_campaign.source_list_id
       and c.deleted_at is null
       and c.blocked = false
       and c.phone_number is not null
       and not exists (
         select 1 from public.voice_campaign_contacts vcc
          where vcc.campaign_id = _campaign_id
            and vcc.contact_id = c.id
       )
    returning 1
  )
  select count(*) into v_count from inserted;

  if v_count = 0 then
    delete from public.campaign_enrollment_batches where id = v_batch_id;
    return jsonb_build_object('enrolled', 0, 'reason', 'no_new_members');
  end if;

  update public.campaign_enrollment_batches
     set contact_count = v_count where id = v_batch_id;

  return jsonb_build_object('enrolled', v_count, 'batchId', v_batch_id);
end;
$function$;
`);

    // Restaura ingest_agent_contact pra versão anterior (IngestModeConfig,
    // sem escrita nas tabelas novas).
    await queryRunner.query(`
create or replace function public.ingest_agent_contact(_account_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set row_security to off
as $function$
declare
  v_agent text := nullif(_payload ->> 'agent', '');
  v_phone text := nullif(_payload ->> 'phone', '');
  v_name text := nullif(_payload ->> 'name', '');
  v_email text := nullif(_payload ->> 'email', '');
  v_external_id text := nullif(_payload ->> 'externalId', '');
  v_razao_social text := nullif(_payload ->> 'razaoSocial', '');
  v_nome_fantasia text := nullif(_payload ->> 'nomeFantasia', '');
  v_vendedor_nome text := nullif(_payload ->> 'vendedorNome', '');
  v_vars jsonb := coalesce(_payload -> 'variables', '{}'::jsonb);
  v_list_key text := coalesce(nullif(_payload ->> 'listKey', ''), 'agent:' || v_agent);
  v_list_name_explicit text := nullif(_payload ->> 'listName', '');
  v_list_name_default text := coalesce(
    nullif(_payload ->> 'defaultListName', ''), 'Agente ' || v_agent);
  v_kind text := nullif(_payload ->> 'campaignKind', '');
  v_list_id uuid;
  v_contact_id uuid;
  v_contact_deleted_at timestamptz;
  v_email_taken boolean := false;
  v_identifier text;
  v_company_id uuid;
  v_vendedor_id uuid;
  v_vendedor_match_count int;
  v_ingest_mode text;
begin
  if v_agent is null then
    raise exception 'agent é obrigatório' using errcode = '22023';
  end if;
  if v_phone is null then
    raise exception 'phone é obrigatório' using errcode = '22023';
  end if;
  if v_phone !~ '^\\+[1-9][0-9]{7,14}$' then
    raise exception 'phone deve estar em E.164 (ex.: +5511999998888), recebido: %', v_phone
      using errcode = '22023';
  end if;

  select coalesce(ingest_mode, 'insert') into v_ingest_mode
    from public.agent_personas
   where id::text = v_agent and account_id = _account_id;
  v_ingest_mode := coalesce(v_ingest_mode, 'insert');

  insert into public.contact_lists (account_id, name, external_key, campaign_kind, description)
  values (_account_id, coalesce(v_list_name_explicit, v_list_name_default),
          v_list_key, v_kind,
          'Lista operacional recebida por webhook de integração')
  on conflict (account_id, external_key) where external_key is not null
  do update set name = coalesce(v_list_name_explicit, contact_lists.name),
                campaign_kind = coalesce(excluded.campaign_kind, contact_lists.campaign_kind),
                updated_at = now()
  returning id into v_list_id;

  select id, deleted_at into v_contact_id, v_contact_deleted_at
    from public.contacts
   where account_id = _account_id and phone_number = v_phone
   order by created_at asc
   limit 1;

  if v_contact_id is null then
    v_identifier := 'phone:' || substring(v_phone from 2);
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and identifier = v_identifier
     limit 1;
  end if;

  if v_contact_id is null and v_external_id is not null then
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and external_id = v_external_id
     limit 1;
  end if;

  if v_external_id is not null then
    select id into v_company_id
      from public.companies
     where account_id = _account_id and external_id = v_external_id;

    if v_company_id is null then
      insert into public.companies (account_id, name, razao_social, nome_fantasia, external_id)
      values (_account_id, coalesce(v_razao_social, v_nome_fantasia, v_name, 'Cliente ' || v_external_id),
              v_razao_social, v_nome_fantasia, v_external_id)
      returning id into v_company_id;
    else
      update public.companies
         set razao_social = coalesce(razao_social, v_razao_social),
             nome_fantasia = coalesce(nome_fantasia, v_nome_fantasia),
             updated_at = now()
       where id = v_company_id
         and (razao_social is null and v_razao_social is not null
              or nome_fantasia is null and v_nome_fantasia is not null);
    end if;

    if v_vendedor_nome is not null then
      select count(*), (array_agg(au.user_id))[1]
        into v_vendedor_match_count, v_vendedor_id
        from public.account_users au
        join public.profiles p on p.id = au.user_id
       where au.account_id = _account_id
         and lower(coalesce(p.display_name, p.name, '')) = lower(v_vendedor_nome);

      if v_vendedor_match_count = 1 then
        update public.companies set vendedor_id = v_vendedor_id, updated_at = now()
         where id = v_company_id and vendedor_id is null;
      else
        update public.companies set vendedor_nome_erp = v_vendedor_nome, updated_at = now()
         where id = v_company_id and vendedor_id is null and vendedor_nome_erp is null;
      end if;
    end if;
  end if;

  if v_contact_id is not null and v_contact_deleted_at is not null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'contato removido anteriormente; integração não recria',
      'contactId', v_contact_id,
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
  end if;

  if v_email is not null then
    select exists (
      select 1 from public.contacts
       where account_id = _account_id and email = v_email
         and (v_contact_id is null or id <> v_contact_id)
    ) into v_email_taken;
  end if;

  if v_contact_id is not null then
    if v_ingest_mode = 'insert' then
      return jsonb_build_object(
        'skipped', true,
        'reason', 'contato já existe; integração só insere, não atualiza',
        'contactId', v_contact_id,
        'listId', v_list_id,
        'listKey', v_list_key,
        'phone', v_phone
      );
    end if;

    update public.contacts c
       set name = coalesce(v_name, c.name),
           phone_number = v_phone,
           email = case when v_email is null or v_email_taken then c.email else v_email end,
           external_id = coalesce(c.external_id, v_external_id),
           company_id = coalesce(c.company_id, v_company_id),
           custom_attributes = coalesce(c.custom_attributes, '{}'::jsonb)
             || jsonb_build_object(
                  'agent_key', v_agent,
                  'ingest_variables',
                    coalesce(c.custom_attributes -> 'ingest_variables', '{}'::jsonb) || v_vars
                ),
           last_activity_at = now(),
           updated_at = now()
     where c.id = v_contact_id;

    insert into public.contact_list_members (list_id, contact_id, account_id)
    values (v_list_id, v_contact_id, _account_id)
    on conflict (list_id, contact_id) do nothing;

    update public.contact_lists
       set member_count = (select count(*) from public.contact_list_members
                            where list_id = v_list_id),
           updated_at = now()
     where id = v_list_id;

    return jsonb_build_object(
      'skipped', false,
      'contactId', v_contact_id,
      'created', false,
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
  end if;

  insert into public.contacts
    (account_id, name, phone_number, email, identifier, external_id, company_id, source,
     custom_attributes, last_activity_at)
  values
    (_account_id, v_name, v_phone,
     case when v_email_taken then null else v_email end,
     'phone:' || substring(v_phone from 2), v_external_id, v_company_id, 'inbound',
     jsonb_build_object('agent_key', v_agent, 'ingest_variables', v_vars),
     now())
  on conflict (account_id, identifier) where identifier is not null
  do nothing
  returning id into v_contact_id;

  if v_contact_id is null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'contato já existe; integração só insere, não atualiza',
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
  end if;

  insert into public.contact_list_members (list_id, contact_id, account_id)
  values (v_list_id, v_contact_id, _account_id)
  on conflict (list_id, contact_id) do nothing;

  update public.contact_lists
     set member_count = (select count(*) from public.contact_list_members
                          where list_id = v_list_id),
         updated_at = now()
   where id = v_list_id;

  return jsonb_build_object(
    'skipped', false,
    'contactId', v_contact_id,
    'created', true,
    'listId', v_list_id,
    'listKey', v_list_key,
    'phone', v_phone
  );
end;
$function$;
`);

    await queryRunner.query(
      `drop function if exists public.contact_erp_variables(uuid);`,
    );
    await queryRunner.query(`drop table if exists public.orcamentos_erp;`);
    await queryRunner.query(`drop table if exists public.cobranca_titulos;`);
    await queryRunner.query(
      `alter table public.agent_personas drop column if exists document_kind;`,
    );
  }
}
