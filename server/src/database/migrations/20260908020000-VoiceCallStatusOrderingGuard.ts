import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `voice_call_update_status_by_sid` (20260720240000-TwilioVoiceIngestBypass.ts)
 * unconditionally overwrote `voice_calls.status` on every Twilio
 * StatusCallback. Twilio does not guarantee in-order delivery (retries/
 * network races are documented behavior) — a stale `ringing` or
 * `in-progress` callback arriving after `completed` was already processed
 * regressed the row back to a non-terminal status while `ended_at`/
 * `duration_seconds` still reflected completion. That already-regressed
 * row could then be picked up by `CallOpsService.cancel()` (which only
 * targets `queued`/`ringing`/`in_progress` rows) and get overwritten again
 * to `canceled`, permanently losing the correct terminal outcome of a
 * call that already finished (and may have been classified/billed).
 *
 * Fix: only apply the update when the incoming status is not earlier in
 * the call lifecycle than the status already stored — a fixed rank per
 * status, comparing old vs new instead of trusting arrival order.
 */
export class VoiceCallStatusOrderingGuard20260908020000
  implements MigrationInterface
{
  name = 'VoiceCallStatusOrderingGuard20260908020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.voice_call_update_status_by_sid(
  _sid text, _status text, _duration int, _recording_url text, _terminal boolean
)
RETURNS TABLE(id uuid, recording_storage_path text, transcription_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.voice_calls SET
    status = _status::voice_call_status,
    duration_seconds = CASE WHEN _duration > 0 THEN _duration ELSE duration_seconds END,
    recording_url = COALESCE(_recording_url, recording_url),
    ended_at = CASE WHEN _terminal THEN now() ELSE ended_at END,
    updated_at = now()
  WHERE provider_call_sid = _sid
    AND (
      CASE status::text
        WHEN 'queued' THEN 0 WHEN 'ringing' THEN 1 WHEN 'in_progress' THEN 2
        ELSE 3
      END
      <=
      CASE _status
        WHEN 'queued' THEN 0 WHEN 'ringing' THEN 1 WHEN 'in_progress' THEN 2
        ELSE 3
      END
    )
  RETURNING id, recording_storage_path, transcription_status;
$$;
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.voice_call_update_status_by_sid(
  _sid text, _status text, _duration int, _recording_url text, _terminal boolean
)
RETURNS TABLE(id uuid, recording_storage_path text, transcription_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.voice_calls SET
    status = _status::voice_call_status,
    duration_seconds = CASE WHEN _duration > 0 THEN _duration ELSE duration_seconds END,
    recording_url = COALESCE(_recording_url, recording_url),
    ended_at = CASE WHEN _terminal THEN now() ELSE ended_at END,
    updated_at = now()
  WHERE provider_call_sid = _sid
  RETURNING id, recording_storage_path, transcription_status;
$$;
`);
  }
}
