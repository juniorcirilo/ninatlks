-- Pipeline de finalização de chamadas EL: marca origem do acordo + índice
-- pra cron pegar pendentes + agenda cron de 2 em 2 min.

-- 1. Marca origem dos acordos (transcript_extraction | agent_tool | manual)
ALTER TABLE public.payment_arrangements
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'agent_tool';

-- 2. Índice pra cron pegar chamadas pendentes de finalização
CREATE INDEX IF NOT EXISTS idx_voice_calls_pending_finalize
  ON public.voice_calls (started_at)
  WHERE status IN ('queued','ringing','in_progress') AND source_id IS NOT NULL;

-- 3. Bucket de gravações (caso ainda não exista)
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-recordings', 'voice-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- 4. Policies pro bucket voice-recordings (member da account pode ler via signed URL gerado pelo backend; service role bypassa)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='voice_recordings_member_read'
  ) THEN
    CREATE POLICY "voice_recordings_member_read"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'voice-recordings'
        AND EXISTS (
          SELECT 1 FROM public.account_users au
          WHERE au.user_id = auth.uid()
            AND au.account_id::text = (storage.foldername(name))[1]
        )
      );
  END IF;
END $$;