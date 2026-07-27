import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421240000_contacts_dedup.sql.
export class ContactsDedup20260421240000 implements MigrationInterface {
  name = 'ContactsDedup20260421240000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Contacts dedup + identifier uniqueness.
--
-- Bug: multiple webhook deliveries (Zernio retries, concurrent events) could
-- race past the \`contact_inboxes\` check in the incoming handlers and create
-- duplicate \`contacts\` rows for the same person. Screenshot showed 3x
-- "Tiago Della Nina" among others.
--
-- Fix (two-step):
--   1. Collapse existing duplicates: for each (account_id, identifier) with
--      more than one row, keep the oldest and migrate FK data from the rest.
--   2. Add UNIQUE(account_id, identifier) so races fail predictably going
--      forward; incoming handlers will use ON CONFLICT / lookup-by-identifier
--      patterns instead of racing inserts.

-- ─────────────────────────────────────────────────────────────
-- Step 1 — merge helper. Moves conversations, contact_inboxes, and any
-- contact_facts / dossier rows from \`src_ids\` into \`dest_id\`, then deletes
-- the duplicates. Used both by this migration's backfill and the runtime
-- contacts-merge edge function.
-- ─────────────────────────────────────────────────────────────
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
    await queryRunner.query(`
revoke all on function public.merge_contacts(uuid, uuid[]) from public;
`);
    await queryRunner.query(`
grant execute on function public.merge_contacts(uuid, uuid[]) to service_role;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- Step 2 — backfill: collapse existing duplicates per (account_id, identifier)
-- before we can add the unique constraint.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_primary uuid;
  v_dups uuid[];
begin
  for r in
    select account_id, identifier
    from public.contacts
    where identifier is not null
    group by account_id, identifier
    having count(*) > 1
  loop
    select array_agg(id order by created_at)
      into v_dups
      from public.contacts
      where account_id = r.account_id and identifier = r.identifier;
    v_primary := v_dups[1];
    v_dups := v_dups[2:array_length(v_dups, 1)];
    perform public.merge_contacts(v_primary, v_dups);
  end loop;
end $$;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- Step 3 — add the unique constraint. Partial so NULL identifiers (manually
-- created contacts without any external link) don't collide.
-- ─────────────────────────────────────────────────────────────
create unique index if not exists uniq_contacts_account_identifier
  on public.contacts(account_id, identifier)
  where identifier is not null;
`);
    await queryRunner.query(`
comment on index public.uniq_contacts_account_identifier is
  'Prevents duplicate contacts per channel identifier. Incoming webhook handlers must upsert by (account_id, identifier).';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'ContactsDedup20260421240000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
