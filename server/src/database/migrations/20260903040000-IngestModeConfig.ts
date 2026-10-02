import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Torna configurável, por agente, o modo de inserção do webhook de contato
 * (`ingest_agent_contact` — AgentInboundInsertOnly20260903020000): 'insert'
 * (padrão atual, contato existente é ignorado) ou 'upsert' (contato
 * existente é atualizado — nome/telefone/email/variáveis, igual ao
 * comportamento de antes do insert-only). Cada agente decide o que faz mais
 * sentido pra integração dele; não é mais um comportamento único pra conta
 * inteira.
 *
 * Fica em `agent_personas` (não em `agent_inbound_sources`) porque cobre os
 * dois caminhos de entrada — push (POST /ingest/agent-contact) e pull (o
 * poller de agent_inbound_sources) — e os dois já chamam a mesma função pelo
 * id da persona.
 */
export class IngestModeConfig20260903040000 implements MigrationInterface {
  name = 'IngestModeConfig20260903040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.agent_personas
  add column if not exists ingest_mode text not null default 'insert';
`);
    await queryRunner.query(`
alter table public.agent_personas
  add constraint agent_personas_ingest_mode_check
  check (ingest_mode in ('insert', 'upsert'));
`);
    await queryRunner.query(`
comment on column public.agent_personas.ingest_mode is
  'Modo do webhook de contato deste agente: insert (padrão, ignora se já existe) ou upsert (atualiza se já existe).';
`);
    await queryRunner.query(`
create or replace function public.ingest_agent_contact(_account_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  -- Nome explícito (o integrador mandou listName) x nome padrão (derivado da
  -- persona). Só o explícito reescreve lista existente: lista configurada à mão
  -- na tela de Recebimento não pode ser renomeada pela primeira carga.
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
  -- A normalização de DDI é do lado TS (toE164, fonte única da regra), então
  -- aqui só entra E.164. Sem esta checagem, um chamador que esquecesse o "+"
  -- criaria contato paralelo (o telefone não casaria com o já gravado) e um
  -- identifier torto — 'phone:' || substring de um número sem "+" come o
  -- primeiro dígito do DDI. Confirmado em teste, não hipótese.
  if v_phone !~ '^\\+[1-9][0-9]{7,14}$' then
    raise exception 'phone deve estar em E.164 (ex.: +5511999998888), recebido: %', v_phone
      using errcode = '22023';
  end if;

  select coalesce(ingest_mode, 'insert') into v_ingest_mode
    from public.agent_personas
   where id::text = v_agent and account_id = _account_id;
  v_ingest_mode := coalesce(v_ingest_mode, 'insert');

  -- Lista operacional por agente: é o gancho que já existe para campanha de voz
  -- (voice_campaigns.source_list_id + auto_enroll_mode='approval') pegar o
  -- contato novo sem nenhum código de agendamento aqui.
  --
  -- Nome e tipo da lista existente só são preenchidos, nunca apagados nem
  -- sobrescritos por default: a lista pode ter sido criada e ajustada na tela
  -- (Webhooks > Recebimento > Listas operacionais) antes da primeira carga, e
  -- renomeá-la para "Agente X" ou zerar o tipo desfaria a configuração.
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

  -- Fallback pelo identifier derivado do telefone: contato que entrou por
  -- outro caminho pode ter o número gravado só ali.
  if v_contact_id is null then
    v_identifier := 'phone:' || substring(v_phone from 2);
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and identifier = v_identifier
     limit 1;
  end if;

  -- Fallback por external_id: mesma pessoa já cadastrada por uma carga
  -- anterior, agora chegando com telefone diferente (número trocado, DDD
  -- corrigido na origem). Sem isto o INSERT abaixo colide com
  -- contacts_account_external_id_uniq em vez de ser reconhecido como já
  -- existente.
  if v_contact_id is null and v_external_id is not null then
    select id, deleted_at into v_contact_id, v_contact_deleted_at
      from public.contacts
     where account_id = _account_id and external_id = v_external_id
     limit 1;
  end if;

  -- Empresa: roda pra contato novo OU já existente, em ambos os modos — não
  -- é o que "insert" trava (isso é só sobre nome/telefone/variáveis do
  -- contato). Só mexe em companies e no FK contacts.company_id quando
  -- ainda null.
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

    -- Upsert: contato existente é atualizado. Telefone/nome sobrescrevem
    -- (é o dado novo do ERP); external_id só preenche (nunca sequestra um
    -- contato que já tem dono no sistema de origem); variáveis são
    -- mescladas, não substituídas — recebimento parcial não apaga contexto
    -- que a agente já usa na fala.
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

  -- Perdeu a corrida de inserção (outra entrega concorrente do mesmo
  -- telefone criou o contato entre o SELECT e o INSERT): mesma resposta de
  -- "já existe", não erro.
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.ingest_agent_contact(uuid, jsonb);`,
    );
    await queryRunner.query(`
alter table public.agent_personas
  drop constraint if exists agent_personas_ingest_mode_check;
`);
    await queryRunner.query(`
alter table public.agent_personas drop column if exists ingest_mode;
`);
  }
}
