import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Same category as the auth/guards/realtime/jobs fixes before this one,
 * found by continuing the same audit into the webhook receivers: inbound
 * SMS (`TwilioSmsService`) and WhatsApp (`EvolutionWebhooksService`) both
 * funnel into `InboundMessageService.ingest()`, which does a 6-step
 * SELECT/INSERT transaction across `inboxes`/`contacts`/`contact_inboxes`/
 * `conversations`/`messages` — all RLS-enabled+forced, all keyed on
 * `auth.uid()` — via the plain pooled connection, no tenant context (there
 * is none: an inbound webhook isn't "someone", it's an external system
 * authenticated by signature). Under real RLS this silently drops every
 * inbound SMS/WhatsApp message — no error to the provider (webhook still
 * returns 200), the message just never gets stored. Same for the
 * `channels`-by-number/instance lookups and `sms_opt_outs` writes in both
 * services. Unlike the voice/ finding (20260720150000), this pipeline is
 * self-contained pure CRUD with no external API calls or complex live-call
 * state, so it's fixed here in full rather than flagged.
 *
 * `TwilioVoiceService` has the identical pattern but is left alone — it's
 * squarely inside the voice/ domain already flagged as needing a
 * deliberate, careful pass (docs/SUPABASE_CUTOVER.md 4.2), not folded into
 * this messaging-only fix.
 */
export class InboundMessagingBypass20260720160000
  implements MigrationInterface
{
  name = 'InboundMessagingBypass20260720160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_find_channel_by_config(
        _channel_type text, _config_key text, _config_value text
      )
      RETURNS TABLE(id uuid, account_id uuid, config jsonb)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT c.id, c.account_id, c.config FROM public.channels c
        WHERE c.channel_type::text = _channel_type AND c.config->>_config_key = _config_value
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_find_any_channel(_channel_type text)
      RETURNS TABLE(id uuid, account_id uuid, config jsonb)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT c.id, c.account_id, c.config FROM public.channels c
        WHERE c.channel_type::text = _channel_type
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_sms_opt_out(_account_id uuid, _phone text, _reason text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        INSERT INTO public.sms_opt_outs (account_id, phone_number, reason, opted_out_at, opted_back_in_at)
        VALUES (_account_id, _phone, _reason, now(), NULL)
        ON CONFLICT (account_id, phone_number)
        DO UPDATE SET reason = EXCLUDED.reason, opted_out_at = now(), opted_back_in_at = NULL;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_sms_opt_in(_account_id uuid, _phone text)
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.sms_opt_outs SET opted_back_in_at = now()
        WHERE account_id = _account_id AND phone_number = _phone;
      $$;
    `);

    // Mirrors InboundMessageService.ingest() step for step.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_ingest_inbound_message(
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

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.webhook_find_channel_by_config(text, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_find_any_channel(text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_sms_opt_out(uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_sms_opt_in(uuid, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_ingest_inbound_message(uuid, uuid, text, text, text, text, text, text, text, int, jsonb, jsonb) TO ninatlks_app;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.webhook_find_channel_by_config(text, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_find_any_channel(text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_sms_opt_out(uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_sms_opt_in(uuid, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_ingest_inbound_message(uuid, uuid, text, text, text, text, text, text, text, int, jsonb, jsonb) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.webhook_ingest_inbound_message(uuid, uuid, text, text, text, text, text, text, text, int, jsonb, jsonb);`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.webhook_sms_opt_in(uuid, text);`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.webhook_sms_opt_out(uuid, text, text);`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.webhook_find_any_channel(text);`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.webhook_find_channel_by_config(text, text, text);`);
  }
}
