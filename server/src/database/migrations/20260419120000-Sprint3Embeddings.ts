import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419120000_sprint3_embeddings.sql.
export class Sprint3Embeddings20260419120000 implements MigrationInterface {
  name = 'Sprint3Embeddings20260419120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.incident_clusters
  add column if not exists embedding vector(1536),
  add column if not exists member_count integer default 0;
`);
    await queryRunner.query(`
-- ============================================================
-- Sprint 3 — Real semantic search for memory nodes + incident clustering
-- ============================================================
-- customer_memory_nodes.embedding already exists (vector(1536)) from the
-- initial schema. HNSW index already present. What was missing:
--   1. A recall RPC that does cosine-similarity search with tenant filter.
--   2. An analogous function for incident clustering.
--   3. A backfill-friendly query helper.

-- ─────────────────────────────────────────────────────────────
-- memory_recall_topk: tenant-scoped cosine search
-- ─────────────────────────────────────────────────────────────
create or replace function public.memory_recall_topk(
  p_contact_id uuid,
  p_query_embedding vector,
  p_limit int default 12,
  p_min_importance real default 0.0
)
returns table (
  id bigint,
  kind text,
  summary text,
  content text,
  confidence real,
  importance real,
  similarity real,
  source_conversation_id uuid,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.kind,
    n.summary,
    n.content,
    n.confidence,
    n.importance,
    1 - (n.embedding <=> p_query_embedding) as similarity,
    n.source_conversation_id,
    n.metadata,
    n.created_at
  from public.customer_memory_nodes n
  where n.contact_id = p_contact_id
    and n.embedding is not null
    and n.importance >= p_min_importance
    and (n.expires_at is null or n.expires_at > now())
  order by n.embedding <=> p_query_embedding
  limit p_limit;
$$;
`);
    await queryRunner.query(`
comment on function public.memory_recall_topk is
  'Cosine-similarity search over customer_memory_nodes for a given contact. SECURITY DEFINER but filtered by contact_id so callers must enforce tenancy at the app layer before invoking.';
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- incident_cluster_similar: find signals/messages whose embedding is close
-- to a query, for grouping incidents. Used by incidents-cluster to replace
-- the char-hash placeholder.
-- ─────────────────────────────────────────────────────────────
create or replace function public.incident_find_similar(
  p_account_id uuid,
  p_embedding vector,
  p_threshold real default 0.78,
  p_limit int default 20
)
returns table (
  cluster_id bigint,
  representative_summary text,
  similarity real,
  signal_count int
)
language sql
stable
security definer
set search_path = public
as $$
  -- Clusters whose representative embedding lies within the threshold.
  -- Relies on incident_clusters.embedding — column will be added below.
  select
    c.id as cluster_id,
    c.title as representative_summary,
    1 - (c.embedding <=> p_embedding) as similarity,
    coalesce(c.member_count, 0) as signal_count
  from public.incident_clusters c
  where c.account_id = p_account_id
    and c.embedding is not null
    and 1 - (c.embedding <=> p_embedding) >= p_threshold
  order by c.embedding <=> p_embedding
  limit p_limit;
$$;
`);
    await queryRunner.query(`
-- ─────────────────────────────────────────────────────────────
-- incident_clusters: add embedding + member_count if missing
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_incident_clusters_hnsw
  on public.incident_clusters
  using hnsw (embedding vector_cosine_ops)
  where embedding is not null;
`);
    await queryRunner.query(`
-- Expose RPCs to authenticated users
revoke all on function public.memory_recall_topk(uuid, vector, int, real) from public;
`);
    await queryRunner.query(`
grant execute on function public.memory_recall_topk(uuid, vector, int, real) to authenticated, service_role;
`);
    await queryRunner.query(`
revoke all on function public.incident_find_similar(uuid, vector, real, int) from public;
`);
    await queryRunner.query(`
grant execute on function public.incident_find_similar(uuid, vector, real, int) to authenticated, service_role;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Sprint3Embeddings20260419120000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
