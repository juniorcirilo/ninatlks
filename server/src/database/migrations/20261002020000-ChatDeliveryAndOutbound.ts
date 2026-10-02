import { MigrationInterface, QueryRunner } from 'typeorm';

// Chat ao vivo: duas funções SECURITY DEFINER para o webhook do Evolution
// (sem contexto de tenant, mesma convenção de webhook_ingest_inbound_message):
//  - webhook_update_message_status: sent/delivered/read/played/error (MESSAGES_UPDATE)
//  - webhook_set_contact_avatar: foto de perfil do contato (additional_attributes.avatar_url)
//  - webhook_ingest_outbound_message: mensagens enviadas pelo celular do
//    atendente (fromMe) aparecem na conversa existente do contato
export class ChatDeliveryAndOutbound20261002020000 implements MigrationInterface {
  name = 'ChatDeliveryAndOutbound20261002020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Estados: sent(1) < delivered(2) < read(3) < played(4); 'error' só vale
    // enquanto a mensagem não foi entregue (nunca rebaixa delivered/read/played).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_update_message_status(
        _instance text, _source_id text, _status text
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
          JOIN public.channels c ON c.id = i.channel_id
         WHERE i.id = m.inbox_id
           AND c.config->>'evolution_instance_name' = _instance
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

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_ingest_outbound_message(
        _instance text, _identifier text, _source_id text, _content text,
        _content_type int, _content_attributes jsonb
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_channel public.channels%ROWTYPE;
        v_inbox_id uuid;
        v_contact_id uuid;
        v_conversation_id uuid;
        v_message_id uuid;
      BEGIN
        SELECT * INTO v_channel FROM public.channels
         WHERE channel_type::text = 'whatsapp' AND config->>'evolution_instance_name' = _instance
         LIMIT 1;
        IF v_channel.id IS NULL THEN RETURN false; END IF;

        SELECT id INTO v_inbox_id FROM public.inboxes WHERE channel_id = v_channel.id LIMIT 1;
        SELECT id INTO v_contact_id FROM public.contacts
         WHERE account_id = v_channel.account_id AND identifier = _identifier LIMIT 1;
        IF v_inbox_id IS NULL OR v_contact_id IS NULL THEN RETURN false; END IF;

        SELECT id INTO v_conversation_id FROM public.conversations
         WHERE account_id = v_channel.account_id AND contact_id = v_contact_id
           AND inbox_id = v_inbox_id AND status = 0
         ORDER BY last_activity_at DESC LIMIT 1;
        IF v_conversation_id IS NULL THEN RETURN false; END IF;

        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, source_id, additional_attributes, created_at, updated_at)
        VALUES (v_channel.account_id, v_conversation_id, v_inbox_id, _content, _content_type,
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

    // Foto de perfil do contato (guardada em additional_attributes.avatar_url).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_set_contact_avatar(
        _account_id uuid, _identifier text, _url text
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE v_count int;
      BEGIN
        UPDATE public.contacts
           SET additional_attributes = additional_attributes
                 || jsonb_build_object('avatar_url', _url, 'avatar_checked_at', now()),
               updated_at = now()
         WHERE account_id = _account_id AND identifier = _identifier AND deleted_at IS NULL;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count > 0;
      END;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.webhook_set_contact_avatar(uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_update_message_status(text, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_ingest_outbound_message(text, text, text, text, int, jsonb) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.webhook_set_contact_avatar(uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_update_message_status(text, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_ingest_outbound_message(text, text, text, text, int, jsonb) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_set_contact_avatar(uuid, text, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_ingest_outbound_message(text, text, text, text, int, jsonb);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_update_message_status(text, text, text);`,
    );
  }
}
