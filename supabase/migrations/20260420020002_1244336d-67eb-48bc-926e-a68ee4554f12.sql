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
    AND c.status IN ('open', 'acknowledged', 'detected')
    AND c.last_seen_at >= now() - make_interval(hours => p_lookback_hours)
    AND (1 - (c.embedding <=> p_embedding)) >= p_threshold
  ORDER BY c.embedding <=> p_embedding ASC
  LIMIT 1;
$$;