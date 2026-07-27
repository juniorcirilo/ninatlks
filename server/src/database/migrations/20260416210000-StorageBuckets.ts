import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416210000_storage_buckets.sql.
export class StorageBuckets20260416210000 implements MigrationInterface {
  name = 'StorageBuckets20260416210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Storage buckets: recordings, voice clones, attachments
-- ============================================================
-- All buckets are private; access is mediated by RLS policies that check
-- membership in the owning account. Object key convention (enforced by
-- app code but documented here): \`<account_id>/<...rest>\`.

insert into storage.buckets (id, name, public)
values
  ('voice-recordings', 'voice-recordings', false),
  ('voice-clones',     'voice-clones',     false),
  ('attachments',      'attachments',      false)
on conflict (id) do nothing;
`);
    await queryRunner.query(`
-- ============================================================
-- Helper: account_id extracted from the first path segment.
-- storage.foldername returns {segment1, segment2, ...}
-- ============================================================
create or replace function public.storage_account_from_name(object_name text)
returns uuid
language sql
stable
as $$
  select (storage.foldername(object_name))[1]::uuid;
$$;
`);
    await queryRunner.query(`
-- ============================================================
-- Policies — voice-recordings
-- Read/Write: any authenticated user that belongs to the owning account.
-- ============================================================
drop policy if exists "voice_recordings_select" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "voice_recordings_insert" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "voice_recordings_update" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "voice_recordings_delete" on storage.objects;
`);
    await queryRunner.query(`
create policy "voice_recordings_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "voice_recordings_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "voice_recordings_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "voice_recordings_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );
`);
    await queryRunner.query(`
-- ============================================================
-- Policies — voice-clones (voice model uploads, admin-only write)
-- ============================================================
drop policy if exists "voice_clones_select" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "voice_clones_insert" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "voice_clones_delete" on storage.objects;
`);
    await queryRunner.query(`
create policy "voice_clones_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-clones'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "voice_clones_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-clones'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );
`);
    await queryRunner.query(`
create policy "voice_clones_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-clones'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );
`);
    await queryRunner.query(`
-- ============================================================
-- Policies — attachments (conversation media)
-- ============================================================
drop policy if exists "attachments_select" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "attachments_insert" on storage.objects;
`);
    await queryRunner.query(`
drop policy if exists "attachments_delete" on storage.objects;
`);
    await queryRunner.query(`
create policy "attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
    await queryRunner.query(`
create policy "attachments_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'StorageBuckets20260416210000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
