import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419140000_sprint6_retention_gdpr.sql.
export class Sprint6RetentionGdpr20260419140000 implements MigrationInterface {
  name = 'Sprint6RetentionGdpr20260419140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Sprint 6 — Data retention + GDPR/LGPD readiness
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. Soft delete on contacts + conversations
-- ─────────────────────────────────────────────────────────────
alter table public.contacts add column if not exists deleted_at timestamptz;
`);
    await queryRunner.query(`
alter table public.conversations add column if not exists deleted_at timestamptz;
`);
    await queryRunner.query(`
-- Active-only indexes so RLS policies reading \`deleted_at IS NULL\` don't
-- have to scan the tombstones.
create index if not exists idx_contacts_active
  on public.contacts(account_id, last_activity_at desc)
  where deleted_at is null;
`);
    await queryRunner.query(`
create index if not exists idx_conversations_active
  on public.conversations(account_id, status, last_activity_at desc)
  where deleted_at is null;
`);
    await queryRunner.query(`
-- RLS: existing select policies already filter by account membership. We
-- refine them to hide tombstones from non-admin readers. Admins can see
-- deleted rows via a dedicated policy.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname='public' and tablename='contacts' and policyname like '%_select_%'
  loop
    execute format('drop policy if exists %I on public.contacts', p.policyname);
  end loop;
end $$;
`);
    await queryRunner.query(`
create policy "contacts_select_member_active" on public.contacts
  for select to authenticated
  using (is_account_member(auth.uid(), account_id) and deleted_at is null);
`);
    await queryRunner.query(`
create policy "contacts_select_admin_all" on public.contacts
  for select to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname='public' and tablename='conversations' and policyname like '%_select_%'
  loop
    execute format('drop policy if exists %I on public.conversations', p.policyname);
  end loop;
end $$;
`);
    await queryRunner.query(`
create policy "conversations_select_member_active" on public.conversations
  for select to authenticated
  using (is_account_member(auth.uid(), account_id) and deleted_at is null);
`);
    await queryRunner.query(`
create policy "conversations_select_admin_all" on public.conversations
  for select to authenticated
  using (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 2. Right-to-erasure: hard-delete function with cascade
-- ─────────────────────────────────────────────────────────────
-- Admin-invoked. Removes the contact + all dependent rows. Returns a
-- JSON summary for audit logging.
create or replace function public.erase_contact_data(p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_caller uuid := auth.uid();
  v_result jsonb := '{}'::jsonb;
  v_count int;
begin
  select account_id into v_account_id from public.contacts where id = p_contact_id;
  if v_account_id is null then
    return jsonb_build_object('error', 'contact_not_found');
  end if;

  if not has_role(v_caller, v_account_id, 'admin'::app_role) then
    raise exception 'admin role required';
  end if;

  -- Delete in dependency order (FKs with CASCADE will pick up the rest).
  delete from public.customer_memory_nodes where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('memory_nodes', v_count);

  delete from public.contact_facts where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('contact_facts', v_count);

  delete from public.contact_dossiers where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('contact_dossiers', v_count);

  delete from public.memory_extraction_state where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('memory_extraction_state', v_count);

  -- Conversations + messages cascade via FK
  delete from public.conversations where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('conversations', v_count);

  delete from public.contact_inboxes where contact_id = p_contact_id;
  get diagnostics v_count = row_count;
  v_result := v_result || jsonb_build_object('contact_inboxes', v_count);

  delete from public.contacts where id = p_contact_id;

  insert into public.audit_log (account_id, actor_id, entity_type, entity_id, action, metadata)
  values (v_account_id, v_caller, 'contact', p_contact_id::text, 'erase', v_result);

  return v_result || jsonb_build_object('contact_id', p_contact_id, 'erased_at', now());
end;
$$;
`);
    await queryRunner.query(`
revoke all on function public.erase_contact_data(uuid) from public;
`);
    await queryRunner.query(`
grant execute on function public.erase_contact_data(uuid) to authenticated;
`);
    await queryRunner.query(`
comment on function public.erase_contact_data(uuid) is
  'LGPD/GDPR right-to-erasure. Admin-only. Deletes contact + all dependent rows and writes an audit_log entry.';
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 3. Soft delete helper (non-cascading)
-- ─────────────────────────────────────────────────────────────
create or replace function public.soft_delete_contact(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_caller uuid := auth.uid();
begin
  select account_id into v_account_id from public.contacts where id = p_contact_id;
  if v_account_id is null then
    raise exception 'contact not found';
  end if;
  if not is_account_member(v_caller, v_account_id) then
    raise exception 'not a member';
  end if;

  update public.contacts set deleted_at = now() where id = p_contact_id;
  update public.conversations set deleted_at = now() where contact_id = p_contact_id and deleted_at is null;

  insert into public.audit_log (account_id, actor_id, entity_type, entity_id, action, metadata)
  values (v_account_id, v_caller, 'contact', p_contact_id::text, 'soft_delete', '{}'::jsonb);
end;
$$;
`);
    await queryRunner.query(`
revoke all on function public.soft_delete_contact(uuid) from public;
`);
    await queryRunner.query(`
grant execute on function public.soft_delete_contact(uuid) to authenticated;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- 4. Retention cron — daily delete of messages older than 1 year
--    (keeps conversations + outcomes intact, only trims the transcript)
-- ─────────────────────────────────────────────────────────────
select public.schedule_edge_cron(
  'nexus-retention-messages',
  '30 3 * * *',
  'messages-retention',
  '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Sprint6RetentionGdpr20260419140000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
