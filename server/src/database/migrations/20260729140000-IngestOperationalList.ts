import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ingest_operational_list` — carga de lista operacional vinda de sistema
 * externo (ERP → n8n → aqui), em uma única chamada atômica.
 *
 * SECURITY DEFINER pelo mesmo motivo de guard_resolve_api_key: a requisição é
 * autenticada por chave de API, não por sessão, então não existe `auth.uid()`
 * e toda policy de RLS de `contacts`/`contact_lists` devolveria zero linhas. A
 * conta não vem do payload — vem resolvida do hash da chave pelo guard —, e é
 * o único parâmetro de escopo, então a função não tem como escrever na conta
 * errada mesmo que o corpo peça.
 *
 * Faz numa transação só, e nesta ordem:
 *  1. garante a lista pela chave externa (`external_key`), idempotente: a
 *     mesma carga rodando de novo atualiza a lista em vez de criar outra;
 *  2. faz upsert de cada contato — casando primeiro por external_id, depois
 *     por identifier, e só então inserindo. Sem esse fallback, base que já
 *     estava no produto (importada por CSV, por exemplo) viraria contato
 *     duplicado na primeira carga do ERP;
 *  3. grava as variáveis da operação em custom_attributes.ingest_variables —
 *     é daqui que saem {{valor_titulo}}, {{vencimento}}, {{numero_orcamento}}
 *     na fala da agente;
 *  4. sincroniza os membros da lista. Em replace_members, quem sumiu da carga
 *     sai da lista (título pago no ERP para de ser ligado), mas o contato em
 *     si nunca é apagado — só deixa de ser membro.
 *
 * Telefone chega já normalizado em E.164 pelo serviço (toE164, região BR);
 * plpgsql não teria como decidir DDI, e a regra precisa viver num lugar só.
 */
export class IngestOperationalList20260729140000 implements MigrationInterface {
  name = 'IngestOperationalList20260729140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.contact_lists
  add column if not exists external_key text;
`);
    await queryRunner.query(`
comment on column public.contact_lists.external_key is
  'Chave estável da lista no sistema de origem. Deixa a carga do ERP ser idempotente: mesma chave = mesma lista.';
`);
    await queryRunner.query(`
create unique index if not exists contact_lists_account_external_key_uniq
  on public.contact_lists(account_id, external_key)
  where external_key is not null;
`);

    await queryRunner.query(`
create or replace function public.ingest_operational_list(
  _account_id uuid,
  _payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_list_key text := nullif(_payload ->> 'listKey', '');
  v_list_name text := coalesce(nullif(_payload ->> 'listName', ''), v_list_key);
  v_kind text := nullif(_payload ->> 'campaignKind', '');
  v_replace boolean := coalesce((_payload ->> 'replaceMembers')::boolean, false);
  v_rows jsonb := coalesce(_payload -> 'rows', '[]'::jsonb);
  v_list_id uuid;
  v_row jsonb;
  v_external_id text;
  v_identifier text;
  v_phone text;
  v_email text;
  v_name text;
  v_vars jsonb;
  v_contact_id uuid;
  v_contact_deleted_at timestamptz;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_touched uuid[] := array[]::uuid[];
  v_removed int := 0;
begin
  if v_list_key is null then
    raise exception 'listKey é obrigatório' using errcode = '22023';
  end if;

  insert into public.contact_lists (account_id, name, external_key, campaign_kind, description)
  values (_account_id, coalesce(v_list_name, v_list_key), v_list_key, v_kind,
          'Lista operacional sincronizada por integração externa')
  on conflict (account_id, external_key) where external_key is not null
  do update set name = excluded.name,
                campaign_kind = coalesce(excluded.campaign_kind, contact_lists.campaign_kind),
                updated_at = now()
  returning id into v_list_id;

  for v_row in select * from jsonb_array_elements(v_rows)
  loop
    v_external_id := nullif(v_row ->> 'externalId', '');
    v_phone := nullif(v_row ->> 'phone', '');
    v_email := nullif(v_row ->> 'email', '');
    v_name := nullif(v_row ->> 'name', '');
    v_vars := coalesce(v_row -> 'variables', '{}'::jsonb);

    -- Sem telefone não há operação de voz possível. A linha é contada como
    -- ignorada em vez de virar contato mudo na lista, que só apareceria mais
    -- tarde como contato "na fila" que nunca disca.
    if v_phone is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- source = 'import': contacts_source_check só aceita
    -- inbound|outbound|import|manual, e a origem específica desta carga já
    -- fica registrada de forma mais útil no external_id.
    v_identifier := coalesce('email:' || v_email, 'phone:' || substring(v_phone from 2));
    -- Zerados a cada volta: um SELECT INTO que não roda (porque a linha não
    -- trouxe externalId) deixaria o valor da linha anterior de pé.
    v_contact_id := null;
    v_contact_deleted_at := null;

    if v_external_id is not null then
      select id, deleted_at into v_contact_id, v_contact_deleted_at
        from public.contacts
       where account_id = _account_id and external_id = v_external_id;
    end if;

    if v_contact_id is null then
      select id, deleted_at into v_contact_id, v_contact_deleted_at
        from public.contacts
       where account_id = _account_id and identifier = v_identifier;
    end if;

    -- Contato apagado (retenção/LGPD) não é ressuscitado por carga do ERP, e
    -- também não pode virar linha nova: os índices únicos de identifier e
    -- external_id não excluem apagados, então a inserção estouraria. Sai como
    -- ignorado, e o operador decide o que fazer com ele fora da integração.
    if v_contact_id is not null and v_contact_deleted_at is not null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_contact_id is null then
      insert into public.contacts
        (account_id, name, phone_number, email, identifier, external_id, source, custom_attributes)
      values
        (_account_id, v_name, v_phone, v_email, v_identifier, v_external_id, 'import',
         jsonb_build_object('ingest_variables', v_vars))
      returning id into v_contact_id;
      v_created := v_created + 1;
    else
      update public.contacts c
         set name = coalesce(v_name, c.name),
             phone_number = v_phone,
             email = coalesce(v_email, c.email),
             -- external_id só é preenchido, nunca reescrito por outro valor:
             -- se a linha já tem dono no ERP, uma carga com chave diferente
             -- não deve sequestrar o contato.
             external_id = coalesce(c.external_id, v_external_id),
             custom_attributes = coalesce(c.custom_attributes, '{}'::jsonb)
               || jsonb_build_object('ingest_variables', v_vars),
             updated_at = now()
       where c.id = v_contact_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.contact_list_members (list_id, contact_id, account_id)
    values (v_list_id, v_contact_id, _account_id)
    on conflict (list_id, contact_id) do nothing;

    v_touched := array_append(v_touched, v_contact_id);
  end loop;

  if v_replace then
    with gone as (
      delete from public.contact_list_members m
       where m.list_id = v_list_id
         and not (m.contact_id = any(v_touched))
      returning 1
    )
    select count(*) into v_removed from gone;
  end if;

  update public.contact_lists
     set member_count = (select count(*) from public.contact_list_members
                          where list_id = v_list_id),
         updated_at = now()
   where id = v_list_id;

  return jsonb_build_object(
    'listId', v_list_id,
    'listKey', v_list_key,
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'removed', v_removed,
    'memberCount', (select count(*) from public.contact_list_members where list_id = v_list_id)
  );
end;
$function$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop function if exists public.ingest_operational_list(uuid, jsonb);`,
    );
    await queryRunner.query(
      `drop index if exists public.contact_lists_account_external_key_uniq;`,
    );
    await queryRunner.query(
      `alter table public.contact_lists drop column if exists external_key;`,
    );
  }
}
