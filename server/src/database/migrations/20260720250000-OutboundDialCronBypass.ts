import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `jobs/processors/el-outbound-cron.util.ts` is shared by every cron that
 * dials via ElevenLabs with no HTTP request context — cadence-tick,
 * meeting-reminder-tick, meeting-noshow-tick — all three documented in
 * docs/SUPABASE_CUTOVER.md §2 as "✅ portado, testado", which is true for
 * their own due-work scans (already wrapped, per that doc) but not for
 * this shared dial helper: `resolveOutboundPhoneAndPersona` reads
 * `phone_numbers`/`agent_personas` and `createOutboundVoiceCallRow`/
 * `finalizeOutboundVoiceCall` write `voice_calls`, all via the plain
 * DataSource. Under real RLS every one of these three crons would find
 * "no outbound phone configured" / "no enabled persona" on every tick
 * (zero rows back, not an error) and never actually place a call — found
 * while fixing this file's credential-resolution duplicate
 * (20260720190000-AccountSecretsResolveBypass.ts) and folded into the
 * same voice/ hardening pass since it's the identical gap class.
 */
export class OutboundDialCronBypass20260720250000
  implements MigrationInterface
{
  name = 'OutboundDialCronBypass20260720250000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.outbound_phone_resolve(_account_id uuid)
      RETURNS TABLE(id uuid, e164 text, elevenlabs_phone_number_id text, pinned_persona_id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT pn.id, pn.e164, pn.elevenlabs_phone_number_id, pn.pinned_persona_id
        FROM public.phone_numbers pn
        WHERE pn.account_id = _account_id AND pn.enabled = true AND pn.outbound_enabled = true
        ORDER BY pn.created_at ASC LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.agent_persona_resolve_id_for_account(_account_id uuid)
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.id FROM public.agent_personas p
        WHERE p.account_id = _account_id AND p.enabled = true
        ORDER BY p.created_at ASC LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.agent_persona_get_outbound_info(_id uuid)
      RETURNS TABLE(elevenlabs_agent_id text, name text, system_prompt text, voice_clone_id text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.elevenlabs_agent_id, p.name, p.system_prompt, p.voice_clone_id
        FROM public.agent_personas p WHERE p.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_create_outbound(
        _account_id uuid, _phone_id uuid, _persona_id uuid,
        _from_number text, _to_number text, _metadata jsonb
      )
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.voice_calls
          (account_id, phone_number_id, persona_id, direction, status, provider,
           from_number, to_number, started_at, metadata, created_at, updated_at)
        VALUES (_account_id, _phone_id, _persona_id, 'outbound', 'queued', 'twilio',
                _from_number, _to_number, now(), _metadata, now(), now())
        RETURNING id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_mark_outbound_failed(_id uuid, _error jsonb)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET status = 'failed', metadata = metadata || _error WHERE id = _id;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_mark_outbound_ringing(_id uuid, _provider_call_sid text, _source_id text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.voice_calls SET provider_call_sid = _provider_call_sid, source_id = _source_id, status = 'ringing' WHERE id = _id;
      $$;
    `);

    const grants = [
      'outbound_phone_resolve(uuid)',
      'agent_persona_resolve_id_for_account(uuid)',
      'agent_persona_get_outbound_info(uuid)',
      'voice_call_create_outbound(uuid, uuid, uuid, text, text, jsonb)',
      'voice_call_mark_outbound_failed(uuid, jsonb)',
      'voice_call_mark_outbound_ringing(uuid, text, text)',
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
      'voice_call_mark_outbound_ringing(uuid, text, text)',
      'voice_call_mark_outbound_failed(uuid, jsonb)',
      'voice_call_create_outbound(uuid, uuid, uuid, text, text, jsonb)',
      'agent_persona_get_outbound_info(uuid)',
      'agent_persona_resolve_id_for_account(uuid)',
      'outbound_phone_resolve(uuid)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
