import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423222452_f798e21e-eb86-40fd-8893-7e0ccde0bd4c.sql.
export class Migration20260423222452 implements MigrationInterface {
  name = 'Migration20260423222452';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- 1. Cleanup: merge duplicate inboxes by channel_id
-- ============================================================
WITH canonical AS (
  SELECT channel_id, (array_agg(id ORDER BY created_at))[1] AS canonical_id
  FROM public.inboxes
  WHERE channel_id IS NOT NULL
  GROUP BY channel_id
),
to_remap AS (
  SELECT i.id AS dup_id, c.canonical_id
  FROM public.inboxes i
  JOIN canonical c USING (channel_id)
  WHERE i.id <> c.canonical_id
)
UPDATE public.conversations SET inbox_id = r.canonical_id
FROM to_remap r WHERE conversations.inbox_id = r.dup_id;
`);
    await queryRunner.query(`
WITH canonical AS (
  SELECT channel_id, (array_agg(id ORDER BY created_at))[1] AS canonical_id
  FROM public.inboxes WHERE channel_id IS NOT NULL GROUP BY channel_id
),
to_remap AS (
  SELECT i.id AS dup_id, c.canonical_id FROM public.inboxes i
  JOIN canonical c USING (channel_id) WHERE i.id <> c.canonical_id
)
UPDATE public.messages SET inbox_id = r.canonical_id
FROM to_remap r WHERE messages.inbox_id = r.dup_id;
`);
    await queryRunner.query(`
WITH canonical AS (
  SELECT channel_id, (array_agg(id ORDER BY created_at))[1] AS canonical_id
  FROM public.inboxes WHERE channel_id IS NOT NULL GROUP BY channel_id
),
to_remap AS (
  SELECT i.id AS dup_id FROM public.inboxes i
  JOIN canonical c USING (channel_id) WHERE i.id <> c.canonical_id
)
DELETE FROM public.contact_inboxes
WHERE inbox_id IN (SELECT dup_id FROM to_remap);
`);
    await queryRunner.query(`
WITH canonical AS (
  SELECT channel_id, (array_agg(id ORDER BY created_at))[1] AS canonical_id
  FROM public.inboxes WHERE channel_id IS NOT NULL GROUP BY channel_id
),
to_remap AS (
  SELECT i.id AS dup_id FROM public.inboxes i
  JOIN canonical c USING (channel_id) WHERE i.id <> c.canonical_id
)
DELETE FROM public.inboxes WHERE id IN (SELECT dup_id FROM to_remap);
`);
    await queryRunner.query(`
-- ============================================================
-- 2. UNIQUE index on inboxes(channel_id) — prevent future races
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS inboxes_channel_id_uniq
  ON public.inboxes(channel_id)
  WHERE channel_id IS NOT NULL;
`);
    await queryRunner.query(`
-- ============================================================
-- 3. Atomic RPC: lock contact + select-or-insert conversation
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_open_conversation(
  p_account_id uuid,
  p_contact_id uuid,
  p_inbox_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Serialize concurrent webhook isolates against the same contact
  PERFORM 1 FROM public.contacts WHERE id = p_contact_id FOR UPDATE;

  SELECT id INTO v_id
  FROM public.conversations
  WHERE account_id = p_account_id
    AND contact_id = p_contact_id
    AND inbox_id   = p_inbox_id
    AND status     = 0
  ORDER BY last_activity_at DESC
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.conversations(account_id, contact_id, inbox_id, status)
  VALUES (p_account_id, p_contact_id, p_inbox_id, 0)
  RETURNING id INTO v_id;

  RETURN v_id;
END
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.get_or_create_open_conversation(uuid, uuid, uuid)
  TO authenticated, service_role;
`);
    await queryRunner.query(`
-- ============================================================
-- 4. Cleanup: contacts corrupted by LID parsing bug (>15 digits)
-- ============================================================
DELETE FROM public.messages
WHERE sender_type = 'Contact'
  AND sender_id IN (
    SELECT id FROM public.contacts
    WHERE identifier ~ '^evolution:whatsapp:[0-9]{16,}$'
  );
`);
    await queryRunner.query(`
DELETE FROM public.conversations
WHERE contact_id IN (
  SELECT id FROM public.contacts
  WHERE identifier ~ '^evolution:whatsapp:[0-9]{16,}$'
);
`);
    await queryRunner.query(`
DELETE FROM public.contact_inboxes
WHERE contact_id IN (
  SELECT id FROM public.contacts
  WHERE identifier ~ '^evolution:whatsapp:[0-9]{16,}$'
);
`);
    await queryRunner.query(`
DELETE FROM public.contacts
WHERE identifier ~ '^evolution:whatsapp:[0-9]{16,}$';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423222452 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
