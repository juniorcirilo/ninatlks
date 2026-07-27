import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420015933_2bc66674-c370-410d-9cbc-6f6a4905895f.sql.
export class Migration20260420015933 implements MigrationInterface {
  name = 'Migration20260420015933';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- =============================================================
-- SPRINT 3: EMBEDDINGS
-- =============================================================

-- memory_recall_topk: cosine similarity over customer_memory_nodes.
-- Returns top-K nodes for a contact ranked by 1 - cosine_distance, with importance floor.
CREATE OR REPLACE FUNCTION public.memory_recall_topk(
  p_contact_id uuid,
  p_query_embedding vector(1536),
  p_limit integer DEFAULT 12,
  p_min_importance double precision DEFAULT 0
)
RETURNS TABLE (
  id bigint,
  account_id uuid,
  contact_id uuid,
  kind text,
  summary text,
  content text,
  confidence double precision,
  importance double precision,
  source_conversation_id uuid,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    n.id,
    n.account_id,
    n.contact_id,
    n.kind::text,
    n.summary,
    n.content,
    n.confidence::double precision,
    n.importance::double precision,
    n.source_conversation_id,
    n.expires_at,
    n.metadata,
    n.created_at,
    (1 - (n.embedding <=> p_query_embedding))::double precision AS similarity
  FROM public.customer_memory_nodes n
  WHERE n.contact_id = p_contact_id
    AND n.embedding IS NOT NULL
    AND n.importance >= p_min_importance
    AND (n.expires_at IS NULL OR n.expires_at > now())
  ORDER BY n.embedding <=> p_query_embedding ASC
  LIMIT GREATEST(LEAST(p_limit, 50), 1);
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.memory_recall_topk(uuid, vector, integer, double precision) TO authenticated, service_role;
`);
    await queryRunner.query(`
-- Index to speed cosine search per contact
CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding_cosine
  ON public.customer_memory_nodes
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
`);
    await queryRunner.query(`
-- incident_clusters: add embedding + member_count
ALTER TABLE public.incident_clusters
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_incident_clusters_embedding
  ON public.incident_clusters
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
`);
    await queryRunner.query(`
-- Helper: keep member_count in sync with incident_cluster_members.
CREATE OR REPLACE FUNCTION public.tg_incident_member_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.incident_clusters
       SET member_count = member_count + 1,
           updated_at = now()
     WHERE id = NEW.cluster_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.incident_clusters
       SET member_count = GREATEST(member_count - 1, 0),
           updated_at = now()
     WHERE id = OLD.cluster_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_incident_member_count ON public.incident_cluster_members;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_incident_member_count
AFTER INSERT OR DELETE ON public.incident_cluster_members
FOR EACH ROW EXECUTE FUNCTION public.tg_incident_member_count();
`);
    await queryRunner.query(`
-- Backfill existing member_count
UPDATE public.incident_clusters c
SET member_count = sub.cnt
FROM (
  SELECT cluster_id, COUNT(*)::int AS cnt
  FROM public.incident_cluster_members
  GROUP BY cluster_id
) sub
WHERE sub.cluster_id = c.id;
`);
    await queryRunner.query(`
-- incident_find_similar: returns the most similar OPEN cluster within an account.
CREATE OR REPLACE FUNCTION public.incident_find_similar(
  p_account_id uuid,
  p_embedding vector(1536),
  p_threshold double precision DEFAULT 0.78,
  p_lookback_hours integer DEFAULT 24
)
RETURNS TABLE (
  id bigint,
  title text,
  similarity double precision,
  member_count integer,
  status text,
  last_seen_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.title::text,
    (1 - (c.embedding <=> p_embedding))::double precision AS similarity,
    c.member_count,
    c.status::text,
    c.last_seen_at
  FROM public.incident_clusters c
  WHERE c.account_id = p_account_id
    AND c.embedding IS NOT NULL
    AND c.status IN ('open', 'acknowledged')
    AND c.last_seen_at >= now() - make_interval(hours => p_lookback_hours)
    AND (1 - (c.embedding <=> p_embedding)) >= p_threshold
  ORDER BY c.embedding <=> p_embedding ASC
  LIMIT 1;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.incident_find_similar(uuid, vector, double precision, integer) TO authenticated, service_role;
`);
    await queryRunner.query(`
-- =============================================================
-- SPRINT 4: REALTIME — make sure incident_clusters & conversation_signals stream
-- =============================================================
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.incident_clusters;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
    await queryRunner.query(`
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_signals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
    await queryRunner.query(`
ALTER TABLE public.incident_clusters REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
ALTER TABLE public.conversation_signals REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
-- =============================================================
-- SPRINT 5: LGPD / RETENTION — contact hard-delete RPC
-- =============================================================
CREATE OR REPLACE FUNCTION public.lgpd_delete_contact(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id FROM public.contacts WHERE id = p_contact_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'contact not found';
  END IF;

  IF NOT public.has_role(auth.uid(), v_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required for LGPD deletion';
  END IF;

  -- Cascade delete via FK chains (conversations → messages, signals, etc. via existing FKs)
  DELETE FROM public.customer_memory_nodes WHERE contact_id = p_contact_id;
  DELETE FROM public.contact_facts WHERE contact_id = p_contact_id;
  DELETE FROM public.contact_dossiers WHERE contact_id = p_contact_id;
  DELETE FROM public.csat_surveys WHERE contact_id = p_contact_id;
  DELETE FROM public.conversations WHERE contact_id = p_contact_id;
  DELETE FROM public.contact_inboxes WHERE contact_id = p_contact_id;
  DELETE FROM public.contacts WHERE id = p_contact_id;

  INSERT INTO public.audit_log (account_id, user_id, actor_id, action, entity_type, entity_id, resource_type, resource_id, metadata)
  VALUES (v_account_id, auth.uid(), auth.uid(), 'lgpd_delete', 'contact', p_contact_id::text, 'contact', p_contact_id::text,
          jsonb_build_object('deleted_at', now()));
END;
$$;
`);
    await queryRunner.query(`
GRANT EXECUTE ON FUNCTION public.lgpd_delete_contact(uuid) TO authenticated;
`);
    await queryRunner.query(`
-- =============================================================
-- SPRINT 7: POLISH — additional hot-path indexes
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_signals_account_detected
  ON public.conversation_signals (account_id, detected_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_audit_log_account_created
  ON public.audit_log (account_id, created_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_incident_clusters_account_status
  ON public.incident_clusters (account_id, status, last_seen_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_messages_account_private_created
  ON public.messages (account_id, private, created_at DESC);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420015933 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
