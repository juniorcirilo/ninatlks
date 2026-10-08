import { MigrationInterface, QueryRunner } from 'typeorm';

// WhatsApp direto via Baileys (sem Evolution API).
//  - channels.config passa a guardar só { wa_channel_id, wa_status, ... };
//    as chaves evolution_* são removidas (as sessões precisam de novo QR).
//  - wa_list_channels / wa_set_channel_state: o gerenciador de sessões roda
//    fora de qualquer tenant (boot, eventos do socket), então usa funções
//    SECURITY DEFINER, como os demais webhooks.
//  - webhook_update_message_status / webhook_ingest_outbound_message passam
//    a identificar o canal pelo id (UUID) em vez do nome da instância.
//  - webhook_find_any_channel é removida (ignorava account_id).
export class BaileysDirect20261003010000 implements MigrationInterface {
  name = 'BaileysDirect20261003010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE public.channels
         SET config = jsonb_build_object('wa_channel_id', id::text, 'wa_status', 'disconnected')
       WHERE channel_type::text = 'whatsapp';
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.wa_list_channels()
      RETURNS TABLE(id uuid, account_id uuid, name text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT c.id, c.account_id, c.name FROM public.channels c
         WHERE c.channel_type::text = 'whatsapp' AND c.enabled = true;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.wa_set_channel_state(
        _channel_id uuid, _status text, _phone text, _profile_name text
      )
      RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        UPDATE public.channels
           SET config = config
                 || jsonb_build_object('wa_status', _status)
                 || CASE WHEN _phone IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('wa_phone', _phone) END
                 || CASE WHEN _profile_name IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('wa_profile_name', _profile_name) END,
               updated_at = now()
         WHERE id = _channel_id;
      $$;
    `);

    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_update_message_status(text, text, text);`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_update_message_status(
        _channel_id uuid, _source_id text, _status text
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_new int := CASE _status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'played' THEN 4 WHEN 'error' THEN 0 ELSE -1 END;
        v_count int;
      BEGIN
        IF v_new < 0 THEN RETURN false; END IF;
        UPDATE public.messages m
           SET additional_attributes = m.additional_attributes || jsonb_build_object('delivery_status', _status),
               updated_at = now()
          FROM public.inboxes i
         WHERE i.id = m.inbox_id
           AND i.channel_id = _channel_id
           AND m.source_id = _source_id
           AND m.message_type = 1
           AND CASE
                 WHEN v_new = 0 THEN COALESCE(m.additional_attributes->>'delivery_status', 'sent') IN ('sent', 'error')
                 ELSE v_new > CASE m.additional_attributes->>'delivery_status'
                                WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'played' THEN 4 ELSE 0 END
               END;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count > 0;
      END;
      $$;
    `);

    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_ingest_outbound_message(text, text, text, text, int, jsonb);`,
    );
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_ingest_outbound_message(
        _channel_id uuid, _identifier text, _source_id text, _content text,
        _content_type int, _content_attributes jsonb
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_account_id uuid;
        v_inbox_id uuid;
        v_contact_id uuid;
        v_conversation_id uuid;
        v_message_id uuid;
      BEGIN
        SELECT account_id INTO v_account_id FROM public.channels
         WHERE id = _channel_id AND channel_type::text = 'whatsapp';
        IF v_account_id IS NULL THEN RETURN false; END IF;

        SELECT id INTO v_inbox_id FROM public.inboxes WHERE channel_id = _channel_id LIMIT 1;
        SELECT id INTO v_contact_id FROM public.contacts
         WHERE account_id = v_account_id AND identifier = _identifier LIMIT 1;
        IF v_inbox_id IS NULL OR v_contact_id IS NULL THEN RETURN false; END IF;

        SELECT id INTO v_conversation_id FROM public.conversations
         WHERE account_id = v_account_id AND contact_id = v_contact_id
           AND inbox_id = v_inbox_id AND status = 0
         ORDER BY last_activity_at DESC LIMIT 1;
        IF v_conversation_id IS NULL THEN RETURN false; END IF;

        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, source_id, additional_attributes, created_at, updated_at)
        VALUES (v_account_id, v_conversation_id, v_inbox_id, _content, _content_type,
                _content_attributes, 1, false, 'User', _source_id,
                jsonb_build_object('sent_via', 'phone'), now(), now())
        ON CONFLICT (account_id, source_id) WHERE source_id IS NOT NULL AND source_id <> '' DO NOTHING
        RETURNING id INTO v_message_id;

        IF v_message_id IS NULL THEN RETURN false; END IF;
        UPDATE public.conversations SET last_activity_at = now() WHERE id = v_conversation_id;
        RETURN true;
      END;
      $$;
    `);

    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_find_any_channel(text);`,
    );

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.wa_list_channels() TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.wa_set_channel_state(uuid, text, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_update_message_status(uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_ingest_outbound_message(uuid, text, text, text, int, jsonb) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.wa_list_channels() FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.wa_set_channel_state(uuid, text, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_update_message_status(uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_ingest_outbound_message(uuid, text, text, text, int, jsonb) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // As credenciais evolution_* não são recuperáveis; só remove as funções novas.
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.wa_set_channel_state(uuid, text, text, text);`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.wa_list_channels();`);
  }
}
