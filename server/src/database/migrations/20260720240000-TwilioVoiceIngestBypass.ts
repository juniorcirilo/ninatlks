import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `TwilioVoiceService` (modules/webhooks/twilio-voice.service.ts, ported
 * from supabase/functions/twilio-incoming) resolves inbound/outbound-api
 * Twilio calls to a `phone_numbers` row, creates/finds the `voice_calls`
 * row, resolves persona voice/greeting, and updates call status from the
 * status callback. Both its call sites (`incoming`/`status`) are
 * `@Public()` webhooks — no `TenantTxHost` ever exists on this path, and
 * this is upstream of everything else in the pipeline: if the
 * `voice_calls` row never gets created, nothing downstream (transcription,
 * finalize, personalization) has anything to work on. Flagged in
 * docs/SUPABASE_CUTOVER.md §4.3 as sharing TwilioSmsService/
 * EvolutionWebhooksService's pattern but deliberately left for a dedicated
 * voice/ pass rather than folded into the messaging fix — this is that
 * pass.
 *
 * `agent_persona_get_voice_info` consolidates the original's two separate
 * persona lookups (voice/greeting info, then a second lookup for
 * `elevenlabs_agent_id` only inside the ai_answer/suggest branch) into one
 * — same row, same `pinned_persona_id`, no behavior change since the
 * persona can't change mid-request.
 */
export class TwilioVoiceIngestBypass20260720240000
  implements MigrationInterface
{
  name = 'TwilioVoiceIngestBypass20260720240000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.twilio_phone_number_resolve(_e164 text)
      RETURNS TABLE(
        id uuid, account_id uuid, inbox_id uuid, pinned_persona_id uuid,
        inbound_behavior text, enabled boolean, provider_config jsonb
      )
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT pn.id, pn.account_id, pn.inbox_id, pn.pinned_persona_id,
               pn.inbound_behavior, pn.enabled, pn.provider_config
        FROM public.phone_numbers pn WHERE pn.e164 = _e164 LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_create_from_twilio(
        _account_id uuid, _phone_number_id uuid, _persona_id uuid,
        _direction text, _provider_call_sid text, _from_number text, _to_number text
      )
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.voice_calls
          (account_id, phone_number_id, persona_id, direction, status, provider,
           provider_call_sid, from_number, to_number, started_at, created_at, updated_at)
        VALUES (_account_id, _phone_number_id, _persona_id, _direction::voice_call_direction, 'ringing', 'twilio',
                _provider_call_sid, _from_number, _to_number, now(), now(), now())
        RETURNING id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.agent_persona_get_voice_info(_id uuid)
      RETURNS TABLE(name text, voice_clone_id text, voice_provider text, elevenlabs_agent_id text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.name, p.voice_clone_id, p.voice_provider, p.elevenlabs_agent_id
        FROM public.agent_personas p WHERE p.id = _id LIMIT 1;
      $$;
    `);

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

    const grants = [
      'twilio_phone_number_resolve(text)',
      'voice_call_create_from_twilio(uuid, uuid, uuid, text, text, text, text)',
      'agent_persona_get_voice_info(uuid)',
      'voice_call_update_status_by_sid(text, text, int, text, boolean)',
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
      'voice_call_update_status_by_sid(text, text, int, text, boolean)',
      'agent_persona_get_voice_info(uuid)',
      'voice_call_create_from_twilio(uuid, uuid, uuid, text, text, text, text)',
      'twilio_phone_number_resolve(text)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
