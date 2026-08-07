import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs PersonaAutoReplyService (server/src/modules/messages/) — the
// in-process replacement for the old `tg_trigger_auto_reply` Postgres
// trigger that called out to a Supabase Edge Function (see
// 20260807120000-DropLegacyAutoReplyTrigger.ts, applied right after this
// one). The service runs from an unauthenticated webhook request (no
// TenantTxHost/session), so every multi-table read/write it needs goes
// through SECURITY DEFINER functions here, same convention as
// `webhook_ingest_inbound_message` (20260720160000-InboundMessagingBypass.ts).
//
// `webhook_ingest_inbound_message` itself is extended to return the
// conversation/message ids (was boolean-only) — PersonaAutoReplyService
// needs them right after ingest and it's the only caller.
export class PersonaAutoReplyBypass20260807110000
  implements MigrationInterface
{
  name = 'PersonaAutoReplyBypass20260807110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS public.webhook_ingest_inbound_message(
        uuid, uuid, text, text, text, text, text, text, text, int, jsonb, jsonb
      );
    `);
    await queryRunner.query(`
      CREATE FUNCTION public.webhook_ingest_inbound_message(
        _account_id uuid, _channel_id uuid, _channel_type text, _inbox_name text,
        _identifier text, _contact_name text, _contact_phone text, _source_id text,
        _content text, _content_type int, _content_attributes jsonb, _external_source_ids jsonb
      )
      RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_inbox_id uuid;
        v_contact_id uuid;
        v_conversation_id uuid;
        v_message_id uuid;
      BEGIN
        SELECT id INTO v_inbox_id FROM public.inboxes WHERE channel_id = _channel_id LIMIT 1;
        IF v_inbox_id IS NULL THEN
          INSERT INTO public.inboxes (account_id, channel_id, channel_type, name, created_at, updated_at)
            VALUES (_account_id, _channel_id, _channel_type, _inbox_name, now(), now())
            RETURNING id INTO v_inbox_id;
        END IF;

        SELECT id INTO v_contact_id FROM public.contacts
          WHERE account_id = _account_id AND identifier = _identifier LIMIT 1;
        IF v_contact_id IS NULL THEN
          INSERT INTO public.contacts (account_id, identifier, name, phone_number, created_at, updated_at)
            VALUES (_account_id, _identifier, _contact_name, _contact_phone, now(), now())
            RETURNING id INTO v_contact_id;
        END IF;

        INSERT INTO public.contact_inboxes (contact_id, inbox_id, source_id, created_at, updated_at)
          VALUES (v_contact_id, v_inbox_id, _identifier, now(), now())
          ON CONFLICT (inbox_id, source_id) DO NOTHING;

        SELECT id INTO v_conversation_id FROM public.conversations
          WHERE account_id = _account_id AND contact_id = v_contact_id AND inbox_id = v_inbox_id AND status = 0
          ORDER BY last_activity_at DESC LIMIT 1;
        IF v_conversation_id IS NULL THEN
          INSERT INTO public.conversations (account_id, contact_id, inbox_id, status, last_activity_at, created_at, updated_at)
            VALUES (_account_id, v_contact_id, v_inbox_id, 0, now(), now(), now())
            RETURNING id INTO v_conversation_id;
        END IF;

        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, sender_id, source_id, external_source_ids,
           created_at, updated_at)
        VALUES (_account_id, v_conversation_id, v_inbox_id, _content, _content_type, _content_attributes,
                0, false, 'Contact', v_contact_id, _source_id, _external_source_ids, now(), now())
        ON CONFLICT (account_id, source_id) WHERE source_id IS NOT NULL AND source_id <> '' DO NOTHING
        RETURNING id INTO v_message_id;

        IF v_message_id IS NULL THEN
          RETURN jsonb_build_object(
            'inserted', false, 'conversation_id', v_conversation_id,
            'inbox_id', v_inbox_id, 'message_id', null
          );
        END IF;

        UPDATE public.conversations SET last_activity_at = now() WHERE id = v_conversation_id;
        RETURN jsonb_build_object(
          'inserted', true, 'conversation_id', v_conversation_id,
          'inbox_id', v_inbox_id, 'message_id', v_message_id
        );
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.persona_auto_reply_context(
        _conversation_id uuid, _triggering_message_id uuid
      )
      RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_conv record;
        v_contact record;
        v_trigger record;
        v_persona record;
        v_channel record;
        v_rate record;
        v_recent jsonb;
      BEGIN
        SELECT id, account_id, inbox_id, contact_id, ai_autopilot_enabled, additional_attributes
          INTO v_conv
          FROM public.conversations WHERE id = _conversation_id;
        IF v_conv.id IS NULL THEN
          RETURN NULL;
        END IF;

        SELECT phone_number, identifier INTO v_contact
          FROM public.contacts WHERE id = v_conv.contact_id;

        SELECT id, sender_type, content INTO v_trigger
          FROM public.messages WHERE id = _triggering_message_id;

        -- Persona resolvida pelo deployment do inbox; se não houver, cai pra
        -- qualquer persona habilitada da conta (mesmo fallback do
        -- persona-auto-reply original).
        SELECT p.id AS persona_id, p.system_prompt, true AS deployment_enabled
          INTO v_persona
          FROM public.agent_persona_deployments d
          JOIN public.agent_personas p ON p.id = d.persona_id
         WHERE d.inbox_id = v_conv.inbox_id AND d.enabled = true
         ORDER BY d.created_at DESC
         LIMIT 1;

        IF v_persona.persona_id IS NULL THEN
          SELECT p.id AS persona_id, p.system_prompt, true AS deployment_enabled
            INTO v_persona
            FROM public.agent_personas p
           WHERE p.account_id = v_conv.account_id AND p.enabled = true
           ORDER BY p.created_at DESC
           LIMIT 1;
        END IF;

        SELECT c.config AS channel_config INTO v_channel
          FROM public.inboxes i
          JOIN public.channels c ON c.id = i.channel_id
         WHERE i.id = v_conv.inbox_id;

        SELECT
          MAX(created_at) FILTER (WHERE sender_type = 'AgentBot') AS last_bot_reply_at,
          COUNT(*) FILTER (WHERE sender_type = 'AgentBot' AND created_at > now() - interval '1 hour') AS bot_replies_last_hour
          INTO v_rate
          FROM public.messages WHERE conversation_id = _conversation_id;

        SELECT jsonb_agg(row_to_json(t) ORDER BY t.created_at ASC) INTO v_recent
        FROM (
          SELECT sender_type, content, created_at
            FROM public.messages
           WHERE conversation_id = _conversation_id AND private = false
           ORDER BY created_at DESC
           LIMIT 8
        ) t;

        RETURN jsonb_build_object(
          'account_id', v_conv.account_id,
          'inbox_id', v_conv.inbox_id,
          'contact_id', v_conv.contact_id,
          'contact_phone', v_contact.phone_number,
          'contact_identifier', v_contact.identifier,
          'ai_autopilot_enabled', v_conv.ai_autopilot_enabled,
          'ai_paused', COALESCE((v_conv.additional_attributes->>'ai_paused')::boolean, false),
          'trigger_sender_type', v_trigger.sender_type,
          'trigger_content', v_trigger.content,
          'persona_id', v_persona.persona_id,
          'system_prompt', v_persona.system_prompt,
          'channel_config', v_channel.channel_config,
          'last_bot_reply_at', v_rate.last_bot_reply_at,
          'bot_replies_last_hour', COALESCE(v_rate.bot_replies_last_hour, 0),
          'recent_messages', COALESCE(v_recent, '[]'::jsonb)
        );
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.persona_auto_reply_insert_message(
        _account_id uuid, _conversation_id uuid, _inbox_id uuid, _content text, _persona_id uuid
      )
      RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_message_id uuid;
      BEGIN
        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, sender_id, created_at, updated_at)
        VALUES (_account_id, _conversation_id, _inbox_id, _content, 0, '{"kind":"auto_reply"}'::jsonb,
                1, false, 'AgentBot', _persona_id, now(), now())
        RETURNING id INTO v_message_id;

        UPDATE public.conversations SET last_activity_at = now() WHERE id = _conversation_id;
        RETURN v_message_id;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.persona_auto_reply_insert_message(uuid, uuid, uuid, text, uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.persona_auto_reply_context(uuid, uuid);`,
    );
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS public.webhook_ingest_inbound_message(
        uuid, uuid, text, text, text, text, text, text, text, int, jsonb, jsonb
      );
    `);
    await queryRunner.query(`
      CREATE FUNCTION public.webhook_ingest_inbound_message(
        _account_id uuid, _channel_id uuid, _channel_type text, _inbox_name text,
        _identifier text, _contact_name text, _contact_phone text, _source_id text,
        _content text, _content_type int, _content_attributes jsonb, _external_source_ids jsonb
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_inbox_id uuid;
        v_contact_id uuid;
        v_conversation_id uuid;
        v_message_id uuid;
      BEGIN
        SELECT id INTO v_inbox_id FROM public.inboxes WHERE channel_id = _channel_id LIMIT 1;
        IF v_inbox_id IS NULL THEN
          INSERT INTO public.inboxes (account_id, channel_id, channel_type, name, created_at, updated_at)
            VALUES (_account_id, _channel_id, _channel_type, _inbox_name, now(), now())
            RETURNING id INTO v_inbox_id;
        END IF;

        SELECT id INTO v_contact_id FROM public.contacts
          WHERE account_id = _account_id AND identifier = _identifier LIMIT 1;
        IF v_contact_id IS NULL THEN
          INSERT INTO public.contacts (account_id, identifier, name, phone_number, created_at, updated_at)
            VALUES (_account_id, _identifier, _contact_name, _contact_phone, now(), now())
            RETURNING id INTO v_contact_id;
        END IF;

        INSERT INTO public.contact_inboxes (contact_id, inbox_id, source_id, created_at, updated_at)
          VALUES (v_contact_id, v_inbox_id, _identifier, now(), now())
          ON CONFLICT (inbox_id, source_id) DO NOTHING;

        SELECT id INTO v_conversation_id FROM public.conversations
          WHERE account_id = _account_id AND contact_id = v_contact_id AND inbox_id = v_inbox_id AND status = 0
          ORDER BY last_activity_at DESC LIMIT 1;
        IF v_conversation_id IS NULL THEN
          INSERT INTO public.conversations (account_id, contact_id, inbox_id, status, last_activity_at, created_at, updated_at)
            VALUES (_account_id, v_contact_id, v_inbox_id, 0, now(), now(), now())
            RETURNING id INTO v_conversation_id;
        END IF;

        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, sender_id, source_id, external_source_ids,
           created_at, updated_at)
        VALUES (_account_id, v_conversation_id, v_inbox_id, _content, _content_type, _content_attributes,
                0, false, 'Contact', v_contact_id, _source_id, _external_source_ids, now(), now())
        ON CONFLICT (account_id, source_id) WHERE source_id IS NOT NULL AND source_id <> '' DO NOTHING
        RETURNING id INTO v_message_id;

        IF v_message_id IS NULL THEN
          RETURN false;
        END IF;

        UPDATE public.conversations SET last_activity_at = now() WHERE id = v_conversation_id;
        RETURN true;
      END;
      $$;
    `);
  }
}
