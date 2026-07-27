import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same category as every migration since 20260720100000: the post-call
 * pipeline (CallFinalizeService → CallClassificationService/
 * CallSentimentService → CallSummaryService) runs from webhooks and BullMQ
 * jobs with no session/tenant context, hitting RLS-forced tables directly.
 * Under real RLS this silently no-ops the entire post-call analysis (no
 * classification, no sentiment, no auto-move, no summary — the call itself
 * still completes, but every downstream signal is lost).
 *
 * Scope: only this pipeline (finalize/classify/sentiment/summary — 34 of
 * the ~90 flagged call sites across voice/). transcription, relay,
 * personalization, twilio-voice, agent-tools, voice-guard's one gap, and
 * secrets' two gaps are NOT covered here — see
 * docs/SUPABASE_CUTOVER.md for running status.
 *
 * All business logic (regex heuristics, LLM calls, score/stage decisions)
 * stays in TypeScript exactly as before — only the raw table reads/writes
 * are wrapped.
 */
export class VoicePostCallPipelineBypass20260720170000
  implements MigrationInterface
{
  name = 'VoicePostCallPipelineBypass20260720170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- voice_calls ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_get(_id uuid)
      RETURNS SETOF public.voice_calls
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.voice_calls WHERE id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_update_metadata(_id uuid, _metadata jsonb)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET metadata = _metadata WHERE id = _id;
      $$;
    `);

    // Mirrors CallFinalizeService's dynamic SET clause: nullable params mean
    // "don't touch this column" via COALESCE, matching the original's
    // conditional setClauses.push() behavior exactly.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_finalize(
        _id uuid, _ended_at timestamptz, _metadata jsonb,
        _transcript jsonb DEFAULT NULL, _duration_seconds int DEFAULT NULL,
        _recording_storage_path text DEFAULT NULL, _recording_url text DEFAULT NULL
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET
          status = 'completed',
          ended_at = _ended_at,
          metadata = _metadata,
          transcript = COALESCE(_transcript, transcript),
          duration_seconds = COALESCE(_duration_seconds, duration_seconds),
          recording_storage_path = COALESCE(_recording_storage_path, recording_storage_path),
          recording_url = COALESCE(_recording_url, recording_url),
          transcription_status = CASE WHEN _recording_storage_path IS NOT NULL THEN 'done' ELSE transcription_status END,
          transcription_provider = CASE WHEN _recording_storage_path IS NOT NULL THEN 'elevenlabs' ELSE transcription_provider END,
          transcription_completed_at = CASE WHEN _recording_storage_path IS NOT NULL THEN now() ELSE transcription_completed_at END
        WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_update_classification(
        _id uuid, _outcome_category text, _outcome_confidence numeric, _outcome_summary text, _classification jsonb
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET
          outcome_category = _outcome_category, outcome_confidence = _outcome_confidence,
          outcome_summary = _outcome_summary, outcome_classified_at = now(), classification = _classification
        WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_update_sentiment(_id uuid, _sentiment jsonb)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET sentiment = _sentiment WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_update_summary(_id uuid, _ai_summary text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET ai_summary = _ai_summary WHERE id = _id;
      $$;
    `);

    // --- contacts ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.contact_get_by_id(_id uuid)
      RETURNS SETOF public.contacts
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.contacts WHERE id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.contact_get_by_phone(_account_id uuid, _phone text)
      RETURNS SETOF public.contacts
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.contacts WHERE account_id = _account_id AND phone_number = _phone LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.contact_update_classification(
        _id uuid, _score int, _briefing jsonb, _source text, _stage_id uuid, _name text
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.contacts SET
          score = _score, briefing = _briefing, source = _source,
          stage_id = COALESCE(_stage_id, stage_id), name = COALESCE(_name, name), updated_at = now()
        WHERE id = _id;
      $$;
    `);

    // Mirrors CallSentimentService's baseUpdate()/baseUpdate({stageId}).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.contact_apply_sentiment(
        _id uuid, _sentiment text, _sentiment_score numeric, _new_stage_id uuid DEFAULT NULL
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      BEGIN
        IF _new_stage_id IS NOT NULL THEN
          UPDATE public.contacts SET
            last_sentiment = _sentiment, last_sentiment_score = _sentiment_score,
            stage_id = _new_stage_id, stage_changed_at = now(), auto_moved_at = now(), updated_at = now()
          WHERE id = _id;
        ELSE
          UPDATE public.contacts SET
            last_sentiment = _sentiment, last_sentiment_score = _sentiment_score, updated_at = now()
          WHERE id = _id;
        END IF;
      END;
      $$;
    `);

    // Mirrors CallClassificationService.resolveContactId's insert-with-conflict-fallback exactly.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.contact_get_or_create(
        _account_id uuid, _phone text, _identifier text, _source text, _name text
      )
      RETURNS SETOF public.contacts
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_id uuid;
      BEGIN
        INSERT INTO public.contacts (account_id, phone_number, identifier, source, name, created_at, updated_at)
          VALUES (_account_id, _phone, _identifier, _source, _name, now(), now())
          ON CONFLICT (account_id, identifier) WHERE identifier IS NOT NULL DO NOTHING
          RETURNING id INTO v_id;

        IF v_id IS NULL THEN
          SELECT id INTO v_id FROM public.contacts WHERE account_id = _account_id AND identifier = _identifier LIMIT 1;
        END IF;

        RETURN QUERY SELECT * FROM public.contacts WHERE id = v_id;
      END;
      $$;
    `);

    // --- conversation_outcomes ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.conversation_outcome_insert(
        _account_id uuid, _conversation_id uuid, _contact_id uuid, _outcome_type text,
        _confidence numeric, _source text, _metadata jsonb
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.conversation_outcomes
          (account_id, conversation_id, contact_id, outcome_type, confidence, source, observed_at, metadata, created_at)
        VALUES (_account_id, _conversation_id, _contact_id, _outcome_type, _confidence, _source, now(), _metadata, now());
      $$;
    `);

    // --- voice_campaign_contacts / voice_campaigns / call_outcomes_catalog (smart retry) ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_campaign_contact_get(_id bigint)
      RETURNS TABLE(id bigint, attempts int)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vcc.id, vcc.attempts FROM public.voice_campaign_contacts vcc WHERE vcc.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_campaign_contact_complete(_id bigint)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_campaign_contacts SET status = 'completed', finished_at = now() WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_campaign_contact_fail(_id bigint, _attempts int, _last_error text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_campaign_contacts SET status = 'failed', attempts = _attempts,
          last_error = _last_error, finished_at = now() WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_campaign_contact_requeue(_id bigint, _attempts int, _dispatch_after timestamptz)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_campaign_contacts SET status = 'queued', attempts = _attempts,
          dispatch_after = _dispatch_after, last_attempt_at = now() WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_campaign_get_retry_config(_id uuid)
      RETURNS TABLE(retry_rules jsonb, retry_attempts int, retry_delay_minutes int)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vc.retry_rules, vc.retry_attempts, vc.retry_delay_minutes FROM public.voice_campaigns vc WHERE vc.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.call_outcomes_catalog_get_terminal(_kind text, _code text, _account_id uuid)
      RETURNS TABLE(terminal boolean)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT c.terminal FROM public.call_outcomes_catalog c
        WHERE c.campaign_kind = _kind AND c.code = _code AND (c.account_id = _account_id OR c.account_id IS NULL)
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.call_outcomes_catalog_list(_kind text, _account_id uuid)
      RETURNS SETOF public.call_outcomes_catalog
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT * FROM public.call_outcomes_catalog
        WHERE campaign_kind = _kind AND (account_id = _account_id OR account_id IS NULL)
        ORDER BY position ASC;
      $$;
    `);

    // --- conversations ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.conversation_get_contact_id(_id uuid)
      RETURNS TABLE(contact_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT c.contact_id FROM public.conversations c WHERE c.id = _id LIMIT 1;
      $$;
    `);

    // --- lead_stages / lead_pipelines ---
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.lead_stage_resolve_default(_account_id uuid, _stage_name text)
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT s.id FROM public.lead_stages s
        JOIN public.lead_pipelines p ON p.id = s.pipeline_id
        WHERE p.account_id = _account_id AND p.is_default = true AND s.name = _stage_name
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.lead_stage_get(_id uuid)
      RETURNS TABLE(name text, is_won boolean, is_lost boolean)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT s.name, s.is_won, s.is_lost FROM public.lead_stages s WHERE s.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.lead_pipeline_get_default(_account_id uuid)
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.id FROM public.lead_pipelines p WHERE p.account_id = _account_id AND p.is_default = true LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.lead_stage_find_by_name(_pipeline_id uuid, _name text)
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT s.id FROM public.lead_stages s WHERE s.pipeline_id = _pipeline_id AND s.name ILIKE _name LIMIT 1;
      $$;
    `);

    const grants = [
      'voice_call_get(uuid)',
      'voice_call_update_metadata(uuid, jsonb)',
      'voice_call_finalize(uuid, timestamptz, jsonb, jsonb, int, text, text)',
      'voice_call_update_classification(uuid, text, numeric, text, jsonb)',
      'voice_call_update_sentiment(uuid, jsonb)',
      'voice_call_update_summary(uuid, text)',
      'contact_get_by_id(uuid)',
      'contact_get_by_phone(uuid, text)',
      'contact_update_classification(uuid, int, jsonb, text, uuid, text)',
      'contact_apply_sentiment(uuid, text, numeric, uuid)',
      'contact_get_or_create(uuid, text, text, text, text)',
      'conversation_outcome_insert(uuid, uuid, uuid, text, numeric, text, jsonb)',
      'voice_campaign_contact_get(bigint)',
      'voice_campaign_contact_complete(bigint)',
      'voice_campaign_contact_fail(bigint, int, text)',
      'voice_campaign_contact_requeue(bigint, int, timestamptz)',
      'voice_campaign_get_retry_config(uuid)',
      'call_outcomes_catalog_get_terminal(text, text, uuid)',
      'call_outcomes_catalog_list(text, uuid)',
      'conversation_get_contact_id(uuid)',
      'lead_stage_resolve_default(uuid, text)',
      'lead_stage_get(uuid)',
      'lead_pipeline_get_default(uuid)',
      'lead_stage_find_by_name(uuid, text)',
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
      'lead_stage_find_by_name(uuid, text)',
      'lead_pipeline_get_default(uuid)',
      'lead_stage_get(uuid)',
      'lead_stage_resolve_default(uuid, text)',
      'conversation_get_contact_id(uuid)',
      'call_outcomes_catalog_list(text, uuid)',
      'call_outcomes_catalog_get_terminal(text, text, uuid)',
      'voice_campaign_get_retry_config(uuid)',
      'voice_campaign_contact_requeue(bigint, int, timestamptz)',
      'voice_campaign_contact_fail(bigint, int, text)',
      'voice_campaign_contact_complete(bigint)',
      'voice_campaign_contact_get(bigint)',
      'conversation_outcome_insert(uuid, uuid, uuid, text, numeric, text, jsonb)',
      'contact_get_or_create(uuid, text, text, text, text)',
      'contact_apply_sentiment(uuid, text, numeric, uuid)',
      'contact_update_classification(uuid, int, jsonb, text, uuid, text)',
      'contact_get_by_phone(uuid, text)',
      'contact_get_by_id(uuid)',
      'voice_call_update_summary(uuid, text)',
      'voice_call_update_sentiment(uuid, jsonb)',
      'voice_call_update_classification(uuid, text, numeric, text, jsonb)',
      'voice_call_finalize(uuid, timestamptz, jsonb, jsonb, int, text, text)',
      'voice_call_update_metadata(uuid, jsonb)',
      'voice_call_get(uuid)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
