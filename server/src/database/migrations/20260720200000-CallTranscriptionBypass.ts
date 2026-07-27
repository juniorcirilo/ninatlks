import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `CallTranscriptionService` (modules/voice/call-transcription.service.ts)
 * — ported from supabase/functions/twilio-recording-callback +
 * transcribe-voice — does 6 distinct raw reads/writes against `voice_calls`
 * via the plain DataSource, reached from an unauthenticated Twilio webhook
 * (`persistAndTranscribe`) and, on the one HTTP-authenticated call site
 * (`VoiceOutboundController.retryTranscription`), the service still never
 * uses `TenantTxHost` — same silent-zero-rows gap as the rest of this
 * pass. Every method wrapped: recording persistence never records where
 * the file landed, transcription never finds a call to work on, and every
 * status transition (processing/done/failed) silently no-ops.
 */
export class CallTranscriptionBypass20260720200000
  implements MigrationInterface
{
  name = 'CallTranscriptionBypass20260720200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_get_by_provider_sid(_sid text)
      RETURNS TABLE(id uuid, account_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vc.id, vc.account_id FROM public.voice_calls vc
        WHERE vc.provider_call_sid = _sid LIMIT 1;
      $$;
    `);

    // Mirrors persistAndTranscribe's dynamic SET clause: recording_sid/
    // recording_duration_sec always set; storage_path/url/status='pending'
    // only touched when _storage_path is provided (matches the original's
    // conditional setClauses.push() behavior — untouched when null via
    // COALESCE, forced to 'pending' only in the "stored" branch).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_persist_recording(
        _id uuid, _recording_sid text, _duration_sec int,
        _storage_path text DEFAULT NULL, _url text DEFAULT NULL
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET
          recording_sid = _recording_sid,
          recording_duration_sec = _duration_sec,
          recording_storage_path = COALESCE(_storage_path, recording_storage_path),
          recording_url = COALESCE(_url, recording_url),
          transcription_status = CASE WHEN _storage_path IS NOT NULL THEN 'pending' ELSE transcription_status END
        WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_get_for_transcription(_id uuid)
      RETURNS TABLE(id uuid, account_id uuid, recording_storage_path text, transcription_status text, metadata jsonb)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vc.id, vc.account_id, vc.recording_storage_path, vc.transcription_status, vc.metadata
        FROM public.voice_calls vc WHERE vc.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_set_transcription_status(_id uuid, _status text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET transcription_status = _status WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_set_transcription_failed(_id uuid, _error text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET transcription_status = 'failed', transcription_error = _error WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_set_transcription_done(_id uuid, _transcript jsonb, _metadata jsonb)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET
          transcript = _transcript, transcription_status = 'done',
          transcription_provider = 'deepgram', transcription_completed_at = now(),
          metadata = _metadata
        WHERE id = _id;
      $$;
    `);

    const grants = [
      'voice_call_get_by_provider_sid(text)',
      'voice_call_persist_recording(uuid, text, int, text, text)',
      'voice_call_get_for_transcription(uuid)',
      'voice_call_set_transcription_status(uuid, text)',
      'voice_call_set_transcription_failed(uuid, text)',
      'voice_call_set_transcription_done(uuid, jsonb, jsonb)',
    ];
    for (const sig of grants) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
            GRANT EXECUTE ON FUNCTION public.${sig} TO ninatlks_app;
          END IF;
        END $$;
      `);
      await queryRunner.query(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fns = [
      'voice_call_set_transcription_done(uuid, jsonb, jsonb)',
      'voice_call_set_transcription_failed(uuid, text)',
      'voice_call_set_transcription_status(uuid, text)',
      'voice_call_get_for_transcription(uuid)',
      'voice_call_persist_recording(uuid, text, int, text, text)',
      'voice_call_get_by_provider_sid(text)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
