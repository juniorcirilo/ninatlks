import { MigrationInterface, QueryRunner } from 'typeorm';

// Edição e exclusão de mensagens do WhatsApp (feitas pelo contato, pelo
// celular do atendente ou pelo app). O estado vive em content_attributes:
//   edited, edited_at, deleted, deleted_at, original_content
// `original_content` guarda o texto antes da 1ª edição / antes da exclusão
// para a UI exibir a citação interna.
export class ChatEditDelete20261004010000 implements MigrationInterface {
  name = 'ChatEditDelete20261004010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_apply_message_edit(
        _channel_id uuid, _source_id text, _new_content text
      )
      RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_id uuid;
      BEGIN
        UPDATE public.messages m
           SET content_attributes = m.content_attributes
                 || jsonb_build_object(
                      'edited', true,
                      'edited_at', now(),
                      'original_content',
                      COALESCE(m.content_attributes->'original_content', to_jsonb(m.content))),
               content = _new_content,
               updated_at = now()
          FROM public.inboxes i
         WHERE i.id = m.inbox_id
           AND i.channel_id = _channel_id
           AND m.source_id = _source_id
           AND COALESCE((m.content_attributes->>'deleted')::boolean, false) = false
        RETURNING m.id INTO v_id;
        RETURN v_id;
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_apply_message_revoke(
        _channel_id uuid, _source_id text
      )
      RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_id uuid;
      BEGIN
        UPDATE public.messages m
           SET content_attributes = m.content_attributes
                 || jsonb_build_object(
                      'deleted', true,
                      'deleted_at', now(),
                      'original_content',
                      COALESCE(m.content_attributes->'original_content', to_jsonb(m.content))),
               updated_at = now()
          FROM public.inboxes i
         WHERE i.id = m.inbox_id
           AND i.channel_id = _channel_id
           AND m.source_id = _source_id
        RETURNING m.id INTO v_id;
        RETURN v_id;
      END;
      $$;
    `);

    // Mensagens gravadas antes do envio (auto-reply) recebem o id do WhatsApp
    // depois, para status de entrega, edição e eco do celular casarem.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_set_message_source_id(
        _message_id uuid, _source_id text
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE v_count int;
      BEGIN
        UPDATE public.messages SET source_id = _source_id, updated_at = now()
         WHERE id = _message_id AND (source_id IS NULL OR source_id = '');
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count > 0;
      EXCEPTION WHEN unique_violation THEN
        RETURN false;
      END;
      $$;
    `);

    // Transcrição automática (STT) de áudios, guardada em content_attributes.transcript.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_set_message_transcript(
        _channel_id uuid, _source_id text, _text text
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE v_count int;
      BEGIN
        UPDATE public.messages m
           SET content_attributes = m.content_attributes || jsonb_build_object('transcript', _text),
               updated_at = now()
          FROM public.inboxes i
         WHERE i.id = m.inbox_id AND i.channel_id = _channel_id AND m.source_id = _source_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        RETURN v_count > 0;
      END;
      $$;
    `);

    // Sincroniza nome/telefone do contato existente com o que o WhatsApp informa.
    // Nome só é sobrescrito se estiver vazio, for placeholder/telefone ou for o
    // último nome vindo do WhatsApp (additional_attributes.wa_name): edição manual
    // do usuário nunca é perdida. Se o contato era LID e agora há telefone,
    // migra o identifier para o número (quando ele ainda não existe).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.webhook_sync_contact(
        _account_id uuid, _identifier text, _name text, _phone text, _lid_identifier text
      )
      RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_id uuid;
      BEGIN
        IF _lid_identifier IS NOT NULL AND _lid_identifier <> _identifier THEN
          SELECT id INTO v_id FROM public.contacts
           WHERE account_id = _account_id AND identifier = _lid_identifier AND deleted_at IS NULL;
          IF v_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM public.contacts WHERE account_id = _account_id AND identifier = _identifier) THEN
            BEGIN
              UPDATE public.contacts SET identifier = _identifier,
                     phone_number = COALESCE(phone_number, _phone), updated_at = now()
               WHERE id = v_id;
              UPDATE public.contact_inboxes SET source_id = _identifier
               WHERE contact_id = v_id AND source_id = _lid_identifier;
            EXCEPTION WHEN unique_violation THEN
              NULL;
            END;
          END IF;
        END IF;

        UPDATE public.contacts c
           SET name = CASE
                 WHEN NULLIF(btrim(_name), '') IS NOT NULL AND (
                      c.name IS NULL OR btrim(c.name) = ''
                      OR c.name IN ('WhatsApp', 'WhatsApp (sem número)', 'Grupo')
                      OR c.name = c.phone_number
                      OR c.name = c.additional_attributes->>'wa_name')
                 THEN btrim(_name) ELSE c.name END,
               phone_number = COALESCE(c.phone_number, _phone),
               additional_attributes = c.additional_attributes
                 || CASE WHEN NULLIF(btrim(_name), '') IS NULL THEN '{}'::jsonb
                         ELSE jsonb_build_object('wa_name', btrim(_name)) END,
               updated_at = now()
         WHERE c.account_id = _account_id AND c.identifier = _identifier AND c.deleted_at IS NULL
           AND (
             (NULLIF(btrim(_name), '') IS NOT NULL AND c.name IS DISTINCT FROM btrim(_name))
             OR (c.phone_number IS NULL AND _phone IS NOT NULL)
             OR c.additional_attributes->>'wa_name' IS DISTINCT FROM NULLIF(btrim(_name), '')
           );
        RETURN FOUND;
      END;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.webhook_sync_contact(uuid, text, text, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_apply_message_edit(uuid, text, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_apply_message_revoke(uuid, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_set_message_source_id(uuid, text) TO ninatlks_app;
          GRANT EXECUTE ON FUNCTION public.webhook_set_message_transcript(uuid, text, text) TO ninatlks_app;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.webhook_sync_contact(uuid, text, text, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_apply_message_edit(uuid, text, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_apply_message_revoke(uuid, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_set_message_source_id(uuid, text) FROM PUBLIC;
      REVOKE EXECUTE ON FUNCTION public.webhook_set_message_transcript(uuid, text, text) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_sync_contact(uuid, text, text, text, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_set_message_transcript(uuid, text, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_set_message_source_id(uuid, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_apply_message_edit(uuid, text, text);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.webhook_apply_message_revoke(uuid, text);`,
    );
  }
}
