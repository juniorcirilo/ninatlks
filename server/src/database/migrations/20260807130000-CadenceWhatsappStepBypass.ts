import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs the WhatsApp branch of CadenceTickProcessor
// (server/src/modules/jobs/processors/cadence-tick.processor.ts) — until now
// `channel: 'whatsapp'` steps were accepted by the API/UI but never actually
// executed (marked skipped-but-advanced). The processor runs outside any
// request/session context, so it needs SECURITY DEFINER functions like every
// other cron/job path in this codebase (same convention as
// `outbound_phone_resolve` in 20260720250000-OutboundDialCronBypass.ts).
export class CadenceWhatsappStepBypass20260807130000
  implements MigrationInterface
{
  name = 'CadenceWhatsappStepBypass20260807130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.cadence_whatsapp_step_resolve(_execution_id uuid)
      RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_exec record;
        v_contact record;
        v_channel record;
        v_facts jsonb;
      BEGIN
        SELECT account_id, contact_id INTO v_exec
          FROM public.follow_up_executions WHERE id = _execution_id;
        IF v_exec.account_id IS NULL THEN
          RETURN NULL;
        END IF;

        SELECT name, phone_number, identifier, COALESCE(blocked, false) AS blocked
          INTO v_contact
          FROM public.contacts WHERE id = v_exec.contact_id;

        SELECT i.id AS inbox_id, ch.config AS channel_config
          INTO v_channel
          FROM public.channels ch
          JOIN public.inboxes i ON i.channel_id = ch.id
         WHERE ch.account_id = v_exec.account_id
           AND ch.channel_type = 'whatsapp'
           AND ch.enabled = true
         LIMIT 1;

        -- Variáveis de {{template}} de cobrança já gravadas por
        -- registrar-desfecho-cobranca (agent-tools.service.ts): debt:promise_amount, debt:promise_date.
        SELECT jsonb_object_agg(
                 replace(key, 'debt:', ''),
                 COALESCE(value, value_numeric::text)
               ) INTO v_facts
        FROM (
          SELECT DISTINCT ON (key) key, value, value_numeric
            FROM public.contact_facts
           WHERE contact_id = v_exec.contact_id AND key LIKE 'debt:%'
           ORDER BY key, created_at DESC
        ) f;

        RETURN jsonb_build_object(
          'account_id', v_exec.account_id,
          'contact_id', v_exec.contact_id,
          'contact_name', v_contact.name,
          'contact_phone', v_contact.phone_number,
          'contact_identifier', v_contact.identifier,
          'contact_blocked', COALESCE(v_contact.blocked, false),
          'inbox_id', v_channel.inbox_id,
          'channel_config', v_channel.channel_config,
          'facts', COALESCE(v_facts, '{}'::jsonb)
        );
      END;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.cadence_whatsapp_record_message(
        _account_id uuid, _inbox_id uuid, _contact_id uuid, _content text, _execution_id uuid
      )
      RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_conversation_id uuid;
        v_message_id uuid;
      BEGIN
        SELECT id INTO v_conversation_id FROM public.conversations
         WHERE account_id = _account_id AND contact_id = _contact_id AND inbox_id = _inbox_id AND status = 0
         ORDER BY last_activity_at DESC LIMIT 1;
        IF v_conversation_id IS NULL THEN
          INSERT INTO public.conversations (account_id, contact_id, inbox_id, status, last_activity_at, created_at, updated_at)
            VALUES (_account_id, _contact_id, _inbox_id, 0, now(), now(), now())
            RETURNING id INTO v_conversation_id;
        END IF;

        INSERT INTO public.messages
          (account_id, conversation_id, inbox_id, content, content_type, content_attributes,
           message_type, private, sender_type, created_at, updated_at)
        VALUES (_account_id, v_conversation_id, _inbox_id, _content, 0,
                jsonb_build_object('kind', 'cadence_followup', 'cadence_execution_id', _execution_id),
                1, false, 'AgentBot', now(), now())
        RETURNING id INTO v_message_id;

        UPDATE public.conversations SET last_activity_at = now() WHERE id = v_conversation_id;
        RETURN v_message_id;
      END;
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.cadence_whatsapp_record_message(uuid, uuid, uuid, text, uuid);`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.cadence_whatsapp_step_resolve(uuid);`,
    );
  }
}
