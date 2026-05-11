UPDATE public.voice_calls
SET ended_at = COALESCE(
  (metadata->>'finalized_at')::timestamptz,
  (metadata->>'last_finalize_attempt')::timestamptz,
  started_at + (COALESCE(duration_seconds, 0) || ' seconds')::interval,
  updated_at
)
WHERE ended_at IS NULL
  AND status IN ('completed','failed','busy','no_answer','canceled');