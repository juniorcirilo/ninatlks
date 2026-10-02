import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `empresaNome` — mais um campo de primeira classe pro mapeamento das
 * fontes (Configurações > Webhooks > Fontes de Dados > "Chaves a obter"),
 * pedido pra dar nome de verdade à empresa criada por `empresaId` em vez de
 * só "Empresa <código>". Quando mapeado, tem prioridade sobre razaoSocial/
 * nomeFantasia como `companies.name`, e também corrige o nome em syncs
 * seguintes (não só na criação) — útil pra corrigir nomes ruins herdados
 * do comportamento antigo (nome da empresa = nome do cliente).
 */
export class IngestEmpresaNome20260908080000 implements MigrationInterface {
  name = 'IngestEmpresaNome20260908080000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  v_empresa_id text := nullif(_payload ->> 'empresaId', '');
  v_empresa_nome text := nullif(_payload ->> 'empresaNome', '');
  v_razao_social text := nullif(_payload ->> 'razaoSocial', '');
  v_nome_fantasia text := nullif(_payload ->> 'nomeFantasia', '');
  v_vendedor_nome text := nullif(_payload ->> 'vendedorNome', '');
  v_vars jsonb := coalesce(_payload -> 'variables', '{}'::jsonb);
  v_list_key text := coalesce(nullif(_payload ->> 'listKey', ''), 'agent:' || v_agent);
  v_list_name_explicit text := nullif(_payload ->> 'listName', '');
  v_list_name_default text := coalesce(
    nullif(_payload ->> 'defaultListName', ''), 'Agente ' || v_agent);
  v_kind text := nullif(_payload ->> 'campaignKind', '');
  v_company_id_input uuid := nullif(_payload ->> 'companyId', '')::uuid;
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

  if v_company_id_input is not null then
    -- Reconciliação manual: operador já escolheu/criou a empresa na tela.
    -- Não confia cegamente — precisa pertencer a esta conta.
    select id into v_company_id
      from public.companies
     where id = v_company_id_input and account_id = _account_id;
    if v_company_id is null then
      raise exception 'companyId não pertence a esta conta' using errcode = '22023';
    end if;

    if v_razao_social is not null or v_nome_fantasia is not null then
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
  elsif v_empresa_id is not null then
    -- empresaId, não externalId: só a chave dedicada de empresa. externalId
    -- segue reservado pra deduplicação do contato (pessoa), acima.
    select id into v_company_id
      from public.companies
     where account_id = _account_id and external_id = v_empresa_id;

    if v_company_id is null then
      insert into public.companies (account_id, name, razao_social, nome_fantasia, external_id)
      values (_account_id, coalesce(v_empresa_nome, v_razao_social, v_nome_fantasia, 'Empresa ' || v_empresa_id),
              v_razao_social, v_nome_fantasia, v_empresa_id)
      returning id into v_company_id;
    else
      update public.companies
         set name = coalesce(v_empresa_nome, name),
             razao_social = coalesce(razao_social, v_razao_social),
             nome_fantasia = coalesce(nome_fantasia, v_nome_fantasia),
             updated_at = now()
       where id = v_company_id
         and (v_empresa_nome is not null
              or (razao_social is null and v_razao_social is not null)
              or (nome_fantasia is null and v_nome_fantasia is not null));
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
  elsif v_document_kind is not null then
    -- Cobrança/orçamento sem empresa_id (empresaId) e sem companyId manual:
    -- bloqueia em vez de gravar título/orçamento órfão de empresa (ou,
    -- pior, criar uma empresa por pessoa usando externalId por engano).
    return jsonb_build_object(
      'skipped', true,
      'reason', 'empresa não identificada — informe empresa_id na fonte ou resolva manualmente na tela',
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
  v_empresa_id text := nullif(_payload ->> 'empresaId', '');
  v_razao_social text := nullif(_payload ->> 'razaoSocial', '');
  v_nome_fantasia text := nullif(_payload ->> 'nomeFantasia', '');
  v_vendedor_nome text := nullif(_payload ->> 'vendedorNome', '');
  v_vars jsonb := coalesce(_payload -> 'variables', '{}'::jsonb);
  v_list_key text := coalesce(nullif(_payload ->> 'listKey', ''), 'agent:' || v_agent);
  v_list_name_explicit text := nullif(_payload ->> 'listName', '');
  v_list_name_default text := coalesce(
    nullif(_payload ->> 'defaultListName', ''), 'Agente ' || v_agent);
  v_kind text := nullif(_payload ->> 'campaignKind', '');
  v_company_id_input uuid := nullif(_payload ->> 'companyId', '')::uuid;
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

  if v_company_id_input is not null then
    -- Reconciliação manual: operador já escolheu/criou a empresa na tela.
    -- Não confia cegamente — precisa pertencer a esta conta.
    select id into v_company_id
      from public.companies
     where id = v_company_id_input and account_id = _account_id;
    if v_company_id is null then
      raise exception 'companyId não pertence a esta conta' using errcode = '22023';
    end if;

    if v_razao_social is not null or v_nome_fantasia is not null then
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
  elsif v_empresa_id is not null then
    -- empresaId, não externalId: só a chave dedicada de empresa. externalId
    -- segue reservado pra deduplicação do contato (pessoa), acima.
    select id into v_company_id
      from public.companies
     where account_id = _account_id and external_id = v_empresa_id;

    if v_company_id is null then
      insert into public.companies (account_id, name, razao_social, nome_fantasia, external_id)
      values (_account_id, coalesce(v_razao_social, v_nome_fantasia, 'Empresa ' || v_empresa_id),
              v_razao_social, v_nome_fantasia, v_empresa_id)
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
  elsif v_document_kind is not null then
    -- Cobrança/orçamento sem empresa_id (empresaId) e sem companyId manual:
    -- bloqueia em vez de gravar título/orçamento órfão de empresa (ou,
    -- pior, criar uma empresa por pessoa usando externalId por engano).
    return jsonb_build_object(
      'skipped', true,
      'reason', 'empresa não identificada — informe empresa_id na fonte ou resolva manualmente na tela',
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
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
  }
}
