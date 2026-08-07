import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Recebimento para automação de agente: upsert com o telefone como chave, e os
 * contatos caem numa lista operacional por agente.
 *
 * "Lista operacional" aqui é literalmente o que a tela /listas mostra e o que a
 * campanha de voz aponta em `source_list_id` — mesma estrutura da carga do ERP,
 * com `campaign_kind` preenchido e as variáveis em
 * `custom_attributes.ingest_variables`. Essa chave não é decorativa: é dela que
 * saem `voice_campaign_contacts.variables` (que o dispatcher repassa como
 * dynamic_variables para a ElevenLabs) e o `variable_keys` que a tela oferece
 * na abertura da campanha. Guardar as variáveis com qualquer outro nome faz a
 * agente ligar sem saber do que está falando.
 *
 * Por que não reusar `ingest_operational_list`: lá a chave é `external_id` e,
 * na falta dele, um `identifier` que prefere e-mail (`email:...`). Para quem
 * automatiza agente a partir de um formulário/CRM o e-mail muitas vezes não
 * vem, ou vem diferente do que já está gravado — e aí a mesma pessoa entraria
 * duas vezes e receberia duas ligações. Aqui o telefone é a chave principal, e
 * `external_id`/e-mail são só enriquecimento.
 *
 * Dois cuidados que a versão ingênua deste upsert não tem:
 *
 * 1. `contacts` tem UNIQUE (account_id, email). E-mail que já pertence a outro
 *    contato é descartado em vez de estourar a requisição — o telefone é a
 *    chave, então perder o e-mail é o menor dos males e a integração continua.
 *
 * 2. Contato apagado (retenção/LGPD) não é ressuscitado nem duplicado: os
 *    índices únicos não excluem apagados, então inserir estouraria. Volta como
 *    `skipped` com motivo, e a decisão fica com uma pessoa.
 *
 * SECURITY DEFINER porque a rota é autenticada por chave de API (@Public em
 * relação à sessão): não há `auth.uid()`, então a RLS destas tabelas
 * devolveria zero linhas. Mesma exceção deliberada de `ingest_operational_list`.
 */
export class AgentInboundUpsert20260730190000 implements MigrationInterface {
  name = 'AgentInboundUpsert20260730190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  v_created boolean := false;
  v_identifier text;
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

  if v_contact_id is not null and v_contact_deleted_at is not null then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'contato removido anteriormente; integração não recria',
      'listId', v_list_id,
      'listKey', v_list_key,
      'phone', v_phone
    );
  end if;

  if v_email is not null then
    select exists (
      select 1 from public.contacts
       where account_id = _account_id
         and email = v_email
         and (v_contact_id is null or id <> v_contact_id)
    ) into v_email_taken;
  end if;

  if v_contact_id is null then
    insert into public.contacts
      (account_id, name, phone_number, email, identifier, external_id, source,
       custom_attributes, last_activity_at)
    values
      (_account_id, v_name, v_phone,
       case when v_email_taken then null else v_email end,
       'phone:' || substring(v_phone from 2), v_external_id, 'inbound',
       jsonb_build_object('agent_key', v_agent, 'ingest_variables', v_vars),
       now())
    on conflict (account_id, identifier) where identifier is not null
    do update set phone_number = excluded.phone_number,
                  updated_at = now()
    returning id into v_contact_id;
    v_created := true;
  else
    update public.contacts c
       set name = coalesce(v_name, c.name),
           phone_number = v_phone,
           email = case when v_email is null or v_email_taken then c.email else v_email end,
           -- external_id só é preenchido, nunca reescrito: contato que já tem
           -- dono no sistema de origem não é sequestrado por outra carga.
           external_id = coalesce(c.external_id, v_external_id),
           -- Variáveis são mescladas, não substituídas: recebimento parcial
           -- (só o campo que mudou) não pode apagar o resto do contexto que a
           -- agente usa na fala. Mesma chave da carga do ERP, então contato que
           -- já vinha de lá continua com as variáveis dele e ganha as novas.
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

  return jsonb_build_object(
    'skipped', false,
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
    await queryRunner.query(
      `drop function if exists public.ingest_agent_contact(uuid, jsonb);`,
    );
  }
}
