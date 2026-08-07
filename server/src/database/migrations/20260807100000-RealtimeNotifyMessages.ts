import { MigrationInterface, QueryRunner } from 'typeorm';

// Extends 20260709160000-RealtimeNotify.ts's notify_app_changes() trigger to
// messages/conversations — the new WhatsApp inbox (Live Chat) UI had no live
// updates: an inbound message (or an AI/operator reply) required a manual
// refresh to show up. `messages` payload also carries `conversationId` (same
// pattern already used for `notifications`/`userId`) so the client can
// refetch just the open thread instead of the whole conversation list.
export class RealtimeNotifyMessages20260807100000
  implements MigrationInterface
{
  name = 'RealtimeNotifyMessages20260807100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.notify_app_changes()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_row record;
        v_payload jsonb;
      BEGIN
        v_row := COALESCE(NEW, OLD);
        v_payload := jsonb_build_object(
          'table', TG_TABLE_NAME,
          'op', TG_OP,
          'id', v_row.id,
          'accountId', v_row.account_id
        );
        IF TG_TABLE_NAME = 'notifications' THEN
          v_payload := v_payload || jsonb_build_object('userId', v_row.user_id);
        END IF;
        IF TG_TABLE_NAME = 'messages' THEN
          v_payload := v_payload || jsonb_build_object('conversationId', v_row.conversation_id);
        END IF;
        PERFORM pg_notify('app_changes', v_payload::text);
        RETURN v_row;
      END;
      $$;
    `);

    for (const table of ['messages', 'conversations']) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.${table};`,
      );
      await queryRunner.query(`
        CREATE TRIGGER trg_notify_app_changes
          AFTER INSERT OR UPDATE OR DELETE ON public.${table}
          FOR EACH ROW EXECUTE FUNCTION public.notify_app_changes();
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['messages', 'conversations']) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.${table};`,
      );
    }
    // Function left in place with the messages/notifications branches — the
    // other tables' triggers still call it, dropping it here would break them.
  }
}
