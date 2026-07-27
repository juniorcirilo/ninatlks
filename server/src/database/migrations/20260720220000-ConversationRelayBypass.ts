import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `ConversationRelayService` (modules/voice/conversation-relay.service.ts,
 * ported from supabase/functions/twilio-conversation-relay) is the WS
 * handler for Twilio <ConversationRelay> — attached directly to the raw
 * HTTP server's `upgrade` event (main.ts), completely outside Nest's
 * request/interceptor pipeline, so `TenantContextInterceptor` never runs
 * for it and there is no HTTP-request path at all for this service. Every
 * raw query (initial call/persona lookup, transcript inserts, recent
 * history read) silently no-ops/returns nothing under real RLS — the
 * live-call relay degrades to its hardcoded default system prompt with no
 * transcript ever persisted to `messages`.
 *
 * `voice_call_get(uuid)` from 20260720170000-VoicePostCallPipelineBypass is
 * reused for the initial call lookup (same shape: full `voice_calls` row).
 */
export class ConversationRelayBypass20260720220000
  implements MigrationInterface
{
  name = 'ConversationRelayBypass20260720220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.agent_persona_get_system_prompt(_id uuid)
      RETURNS TABLE(system_prompt text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.system_prompt FROM public.agent_personas p WHERE p.id = _id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.relay_insert_contact_message(
        _account_id uuid, _conversation_id uuid, _content text, _content_attributes jsonb
      )
      RETURNS void
      -- plpgsql (not sql): needs to look up conversations.inbox_id itself —
      -- messages.inbox_id is NOT NULL with no default/trigger to fill it,
      -- and neither the original ported code nor this function's first
      -- draft ever supplied it, so every relay message insert failed
      -- outright (not an RLS gap — a real, pre-existing bug found by
      -- actually exercising this path against real Postgres, not just
      -- typecheck). See docs/SUPABASE_CUTOVER.md for the writeup.
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_inbox_id uuid;
      BEGIN
        SELECT inbox_id INTO v_inbox_id FROM public.conversations WHERE id = _conversation_id;
        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, message_type, sender_type, content_attributes, created_at, updated_at)
        VALUES (_account_id, _conversation_id, v_inbox_id, _content, 4, 0, 'Contact', _content_attributes, now(), now());
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.relay_insert_agent_message(
        _account_id uuid, _conversation_id uuid, _content text, _sender_id uuid, _content_attributes jsonb
      )
      RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_inbox_id uuid;
      BEGIN
        SELECT inbox_id INTO v_inbox_id FROM public.conversations WHERE id = _conversation_id;
        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, message_type, sender_type, sender_id, content_attributes, created_at, updated_at)
        VALUES (_account_id, _conversation_id, v_inbox_id, _content, 4, 1, 'AgentBot', _sender_id, _content_attributes, now(), now());
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.relay_get_recent_messages(_conversation_id uuid, _limit int)
      RETURNS TABLE(content text, sender_type text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT m.content, m.sender_type FROM public.messages m
        WHERE m.conversation_id = _conversation_id AND m.private = false
        ORDER BY m.created_at DESC LIMIT _limit;
      $$;
    `);

    const grants = [
      'agent_persona_get_system_prompt(uuid)',
      'relay_insert_contact_message(uuid, uuid, text, jsonb)',
      'relay_insert_agent_message(uuid, uuid, text, uuid, jsonb)',
      'relay_get_recent_messages(uuid, int)',
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
      'relay_get_recent_messages(uuid, int)',
      'relay_insert_agent_message(uuid, uuid, text, uuid, jsonb)',
      'relay_insert_contact_message(uuid, uuid, text, jsonb)',
      'agent_persona_get_system_prompt(uuid)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
