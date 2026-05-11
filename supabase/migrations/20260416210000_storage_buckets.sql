-- ============================================================
-- Storage buckets: recordings, voice clones, attachments
-- ============================================================
-- All buckets are private; access is mediated by RLS policies that check
-- membership in the owning account. Object key convention (enforced by
-- app code but documented here): `<account_id>/<...rest>`.

insert into storage.buckets (id, name, public)
values
  ('voice-recordings', 'voice-recordings', false),
  ('voice-clones',     'voice-clones',     false),
  ('attachments',      'attachments',      false)
on conflict (id) do nothing;

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

-- ============================================================
-- Policies — voice-recordings
-- Read/Write: any authenticated user that belongs to the owning account.
-- ============================================================
drop policy if exists "voice_recordings_select" on storage.objects;
drop policy if exists "voice_recordings_insert" on storage.objects;
drop policy if exists "voice_recordings_update" on storage.objects;
drop policy if exists "voice_recordings_delete" on storage.objects;

create policy "voice_recordings_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "voice_recordings_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "voice_recordings_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "voice_recordings_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-recordings'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );

-- ============================================================
-- Policies — voice-clones (voice model uploads, admin-only write)
-- ============================================================
drop policy if exists "voice_clones_select" on storage.objects;
drop policy if exists "voice_clones_insert" on storage.objects;
drop policy if exists "voice_clones_delete" on storage.objects;

create policy "voice_clones_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice-clones'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "voice_clones_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voice-clones'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );

create policy "voice_clones_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'voice-clones'
    and public.has_role(auth.uid(), public.storage_account_from_name(name), 'admin'::public.app_role)
  );

-- ============================================================
-- Policies — attachments (conversation media)
-- ============================================================
drop policy if exists "attachments_select" on storage.objects;
drop policy if exists "attachments_insert" on storage.objects;
drop policy if exists "attachments_delete" on storage.objects;

create policy "attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );

create policy "attachments_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_account_member(auth.uid(), public.storage_account_from_name(name))
  );
