import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Duas falhas encontradas em auditoria em `public.merge_contacts` (definida
 * em 20260421240000-ContactsDedup.ts):
 *
 * 1. Segurança entre contas: a função já garante que `p_primary_id` e todos
 *    `p_duplicate_ids` pertencem à MESMA conta entre si, mas nunca compara
 *    essa conta com a conta autorizada pelo chamador. `GdprController` só
 *    checa `has_role(caller, :accountId, 'admin')` da conta da URL — um
 *    admin da conta A pode chamar POST /accounts/A/contacts/merge com
 *    UUIDs de contatos da conta B (adivinhados/vazados) e fundir/apagar
 *    contatos de um tenant que ele não administra. `GdprService` já roda
 *    dentro da transação do `TenantContextInterceptor`, que sempre seta
 *    `app.current_account_id` via `set_config` para requisições
 *    autenticadas — então dá pra validar aqui dentro sem mudar a assinatura
 *    da função nem o call site.
 *
 * 2. Perda de dados por CASCADE: antes de `delete from public.contacts`,
 *    a função só reaponta `conversations`, `contact_inboxes`,
 *    `contact_facts`, `contact_dossiers` e `customer_memory_nodes`. Várias
 *    outras tabelas têm `contact_id ... on delete cascade` e nunca são
 *    tocadas: `contact_tags`, `voice_campaign_contacts`,
 *    `follow_up_executions`, `debtor_profiles`, e agora (2026-09-04)
 *    `cobranca_titulos`/`orcamentos_erp`. Fundir um contato duplicado hoje
 *    apaga silenciosamente todo o histórico de campanha de voz, execuções
 *    de cadência, e títulos/orçamentos em aberto do duplicado.
 */
export class MergeContactsAccountScopeAndCascadeFix20260908010000
  implements MigrationInterface
{
  name = 'MergeContactsAccountScopeAndCascadeFix20260908010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.merge_contacts(
  p_primary_id uuid,
  p_duplicate_ids uuid[]
)
returns table (
  primary_id uuid,
  merged_count int,
  moved_conversations int,
  moved_contact_inboxes int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_dup_accounts uuid[];
  v_dup_count int;
  v_moved_convs int := 0;
  v_moved_cis int := 0;
  v_merged_name text;
  v_merged_phone text;
  v_merged_email text;
  v_merged_custom_attrs jsonb;
  v_caller_account uuid;
begin
  if p_primary_id is null or array_length(p_duplicate_ids, 1) is null then
    raise exception 'primary_id and duplicate_ids are required';
  end if;
  if p_primary_id = any(p_duplicate_ids) then
    raise exception 'primary_id cannot be in duplicate_ids';
  end if;

  select account_id into v_account from public.contacts where id = p_primary_id;
  if v_account is null then
    raise exception 'primary contact % not found', p_primary_id;
  end if;

  select array_agg(distinct account_id) into v_dup_accounts
    from public.contacts where id = any(p_duplicate_ids);
  if v_dup_accounts is null or array_length(v_dup_accounts, 1) <> 1
     or v_dup_accounts[1] <> v_account then
    raise exception 'all contacts must belong to the same account';
  end if;

  -- Chamadas de requisição autenticada sempre têm app.current_account_id
  -- setado pelo TenantContextInterceptor; chamadas de migration/backfill
  -- (sem requisição HTTP) não têm, e continuam permitidas como antes.
  v_caller_account := nullif(current_setting('app.current_account_id', true), '')::uuid;
  if v_caller_account is not null and v_caller_account <> v_account then
    raise exception 'contacts do not belong to the caller''s account';
  end if;

  -- Move conversations. contact_id is NOT NULL but updates are fine.
  update public.conversations
    set contact_id = p_primary_id
    where contact_id = any(p_duplicate_ids);
  get diagnostics v_moved_convs = row_count;

  -- Move contact_inboxes, handling the UNIQUE(inbox_id, source_id) conflict
  -- by preferring whichever row already exists on the primary (so we don't
  -- lose the primary's existing channel links).
  with to_move as (
    select ci.id, ci.inbox_id, ci.source_id, ci.hmac_verified, ci.pubsub_token
    from public.contact_inboxes ci
    where ci.contact_id = any(p_duplicate_ids)
  ),
  collisions as (
    select tm.id
    from to_move tm
    join public.contact_inboxes keep
      on keep.contact_id = p_primary_id
     and keep.inbox_id = tm.inbox_id
     and coalesce(keep.source_id,'') = coalesce(tm.source_id,'')
  )
  delete from public.contact_inboxes where id in (select id from collisions);

  update public.contact_inboxes
    set contact_id = p_primary_id
    where contact_id = any(p_duplicate_ids);
  get diagnostics v_moved_cis = row_count;

  -- Move optional dossier / facts if those tables exist. Guard via
  -- to_regclass so environments without these tables don't break.
  if to_regclass('public.contact_facts') is not null then
    execute 'update public.contact_facts set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;
  if to_regclass('public.contact_dossiers') is not null then
    -- One dossier per contact: delete duplicates, the primary's wins.
    execute 'delete from public.contact_dossiers where contact_id = any($1) and contact_id <> $2'
      using p_duplicate_ids, p_primary_id;
  end if;
  if to_regclass('public.customer_memory_nodes') is not null then
    execute 'update public.customer_memory_nodes set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- Move contact_tags, handling the UNIQUE(account_id, contact_id, tag)
  -- conflict the same way as contact_inboxes above (primary's tag wins).
  if to_regclass('public.contact_tags') is not null then
    execute $q$
      with to_move as (
        select ct.id, ct.tag from public.contact_tags ct where ct.contact_id = any($1)
      ),
      collisions as (
        select tm.id from to_move tm
        join public.contact_tags keep
          on keep.contact_id = $2 and keep.tag = tm.tag
      )
      delete from public.contact_tags where id in (select id from collisions)
    $q$ using p_duplicate_ids, p_primary_id;
    execute 'update public.contact_tags set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- Move voice_campaign_contacts, handling the UNIQUE(campaign_id,
  -- contact_id) conflict — if the primary is already enrolled in the same
  -- campaign, keep the primary's row (it already carries the real call
  -- history/status) and drop the duplicate's.
  if to_regclass('public.voice_campaign_contacts') is not null then
    execute $q$
      with to_move as (
        select vcc.id, vcc.campaign_id from public.voice_campaign_contacts vcc
        where vcc.contact_id = any($1)
      ),
      collisions as (
        select tm.id from to_move tm
        join public.voice_campaign_contacts keep
          on keep.contact_id = $2 and keep.campaign_id = tm.campaign_id
      )
      delete from public.voice_campaign_contacts where id in (select id from collisions)
    $q$ using p_duplicate_ids, p_primary_id;
    execute 'update public.voice_campaign_contacts set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- Move follow_up_executions (no unique constraint on contact_id today).
  if to_regclass('public.follow_up_executions') is not null then
    execute 'update public.follow_up_executions set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- debtor_profiles has contact_id as its PRIMARY KEY (one row per
  -- contact) — same "primary wins" rule as contact_dossiers above, since
  -- a duplicate's row can't be re-pointed onto an id that may already have
  -- one without an explicit merge of the profile fields themselves.
  if to_regclass('public.debtor_profiles') is not null then
    execute 'delete from public.debtor_profiles where contact_id = any($1) and contact_id <> $2'
      using p_duplicate_ids, p_primary_id;
    execute 'update public.debtor_profiles set contact_id = $2 where contact_id = any($1)'
      using p_duplicate_ids, p_primary_id;
  end if;

  -- Move cobranca_titulos, handling the partial UNIQUE(account_id,
  -- contact_id, numero_titulo) WHERE numero_titulo IS NOT NULL conflict.
  if to_regclass('public.cobranca_titulos') is not null then
    execute $q$
      with to_move as (
        select t.id, t.numero_titulo from public.cobranca_titulos t
        where t.contact_id = any($1)
      ),
      collisions as (
        select tm.id from to_move tm
        join public.cobranca_titulos keep
          on keep.contact_id = $2 and keep.numero_titulo = tm.numero_titulo
        where tm.numero_titulo is not null
      )
      delete from public.cobranca_titulos where id in (select id from collisions)
    $q$ using p_duplicate_ids, p_primary_id;
    execute 'update public.cobranca_titulos set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- Move orcamentos_erp, same partial-unique-index handling as above.
  if to_regclass('public.orcamentos_erp') is not null then
    execute $q$
      with to_move as (
        select o.id, o.numero_orcamento from public.orcamentos_erp o
        where o.contact_id = any($1)
      ),
      collisions as (
        select tm.id from to_move tm
        join public.orcamentos_erp keep
          on keep.contact_id = $2 and keep.numero_orcamento = tm.numero_orcamento
        where tm.numero_orcamento is not null
      )
      delete from public.orcamentos_erp where id in (select id from collisions)
    $q$ using p_duplicate_ids, p_primary_id;
    execute 'update public.orcamentos_erp set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  -- Union of custom_attributes (primary wins on keys that already exist).
  -- Captured into variables BEFORE deleting the duplicates: writing these
  -- onto the primary while a duplicate still holds the same email/identifier
  -- would trip the unique constraints on public.contacts.
  select
    coalesce(p.custom_attributes, '{}'::jsonb)
                         || (
                              select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                              from (
                                select d.custom_attributes
                                from public.contacts d
                                where d.id = any(p_duplicate_ids)
                              ) s,
                              lateral jsonb_each(s.custom_attributes)
                              where not p.custom_attributes ? key
                            )
         || coalesce(p.custom_attributes, '{}'::jsonb),
    coalesce(p.name, (select name from public.contacts where id = any(p_duplicate_ids) and name is not null limit 1)),
    coalesce(p.phone_number, (select phone_number from public.contacts where id = any(p_duplicate_ids) and phone_number is not null limit 1)),
    coalesce(p.email, (select email from public.contacts where id = any(p_duplicate_ids) and email is not null limit 1))
    into v_merged_custom_attrs, v_merged_name, v_merged_phone, v_merged_email
    from public.contacts p where p.id = p_primary_id;

  -- Drop the duplicates first — now safe to write the merged fields onto
  -- the primary without colliding with a row we're about to delete anyway.
  delete from public.contacts where id = any(p_duplicate_ids);
  get diagnostics v_dup_count = row_count;

  update public.contacts
     set custom_attributes = v_merged_custom_attrs,
         name = v_merged_name,
         phone_number = v_merged_phone,
         email = v_merged_email
   where id = p_primary_id;

  return query select p_primary_id, v_dup_count, v_moved_convs, v_moved_cis;
end;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restaura a versão anterior de 20260421240000-ContactsDedup.ts — sem
    // a checagem de conta do chamador nem o reaponte das tabelas
    // acrescentadas aqui.
    await queryRunner.query(`
create or replace function public.merge_contacts(
  p_primary_id uuid,
  p_duplicate_ids uuid[]
)
returns table (
  primary_id uuid,
  merged_count int,
  moved_conversations int,
  moved_contact_inboxes int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_dup_accounts uuid[];
  v_dup_count int;
  v_moved_convs int := 0;
  v_moved_cis int := 0;
  v_merged_name text;
  v_merged_phone text;
  v_merged_email text;
  v_merged_custom_attrs jsonb;
begin
  if p_primary_id is null or array_length(p_duplicate_ids, 1) is null then
    raise exception 'primary_id and duplicate_ids are required';
  end if;
  if p_primary_id = any(p_duplicate_ids) then
    raise exception 'primary_id cannot be in duplicate_ids';
  end if;

  select account_id into v_account from public.contacts where id = p_primary_id;
  if v_account is null then
    raise exception 'primary contact % not found', p_primary_id;
  end if;

  select array_agg(distinct account_id) into v_dup_accounts
    from public.contacts where id = any(p_duplicate_ids);
  if v_dup_accounts is null or array_length(v_dup_accounts, 1) <> 1
     or v_dup_accounts[1] <> v_account then
    raise exception 'all contacts must belong to the same account';
  end if;

  update public.conversations
    set contact_id = p_primary_id
    where contact_id = any(p_duplicate_ids);
  get diagnostics v_moved_convs = row_count;

  with to_move as (
    select ci.id, ci.inbox_id, ci.source_id, ci.hmac_verified, ci.pubsub_token
    from public.contact_inboxes ci
    where ci.contact_id = any(p_duplicate_ids)
  ),
  collisions as (
    select tm.id
    from to_move tm
    join public.contact_inboxes keep
      on keep.contact_id = p_primary_id
     and keep.inbox_id = tm.inbox_id
     and coalesce(keep.source_id,'') = coalesce(tm.source_id,'')
  )
  delete from public.contact_inboxes where id in (select id from collisions);

  update public.contact_inboxes
    set contact_id = p_primary_id
    where contact_id = any(p_duplicate_ids);
  get diagnostics v_moved_cis = row_count;

  if to_regclass('public.contact_facts') is not null then
    execute 'update public.contact_facts set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;
  if to_regclass('public.contact_dossiers') is not null then
    execute 'delete from public.contact_dossiers where contact_id = any($1) and contact_id <> $2'
      using p_duplicate_ids, p_primary_id;
  end if;
  if to_regclass('public.customer_memory_nodes') is not null then
    execute 'update public.customer_memory_nodes set contact_id = $1 where contact_id = any($2)'
      using p_primary_id, p_duplicate_ids;
  end if;

  select
    coalesce(p.custom_attributes, '{}'::jsonb)
                         || (
                              select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
                              from (
                                select d.custom_attributes
                                from public.contacts d
                                where d.id = any(p_duplicate_ids)
                              ) s,
                              lateral jsonb_each(s.custom_attributes)
                              where not p.custom_attributes ? key
                            )
         || coalesce(p.custom_attributes, '{}'::jsonb),
    coalesce(p.name, (select name from public.contacts where id = any(p_duplicate_ids) and name is not null limit 1)),
    coalesce(p.phone_number, (select phone_number from public.contacts where id = any(p_duplicate_ids) and phone_number is not null limit 1)),
    coalesce(p.email, (select email from public.contacts where id = any(p_duplicate_ids) and email is not null limit 1))
    into v_merged_custom_attrs, v_merged_name, v_merged_phone, v_merged_email
    from public.contacts p where p.id = p_primary_id;

  delete from public.contacts where id = any(p_duplicate_ids);
  get diagnostics v_dup_count = row_count;

  update public.contacts
     set custom_attributes = v_merged_custom_attrs,
         name = v_merged_name,
         phone_number = v_merged_phone,
         email = v_merged_email
   where id = p_primary_id;

  return query select p_primary_id, v_dup_count, v_moved_convs, v_moved_cis;
end;
$$;
`);
  }
}
