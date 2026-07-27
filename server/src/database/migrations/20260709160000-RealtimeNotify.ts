import { MigrationInterface, QueryRunner } from 'typeorm';

// Fase 6 (realtime): generic trigger that pg_notify()s a small JSON payload
// on channel `app_changes` — replaces the 6 uses of Supabase's
// `postgres_changes` (which relied on logical replication, not available
// outside Supabase's managed Postgres). PgListenService holds a dedicated
// connection LISTENing on this channel and re-broadcasts over Socket.io.
//
// Payload only carries `table`/`op`/`id`/`accountId`(/`userId`) — never the
// full row (pg_notify truncates at 8000 bytes) — clients treat it as a
// cache-invalidation signal and refetch via the existing REST endpoints.
export class RealtimeNotify20260709160000 implements MigrationInterface {
  name = 'RealtimeNotify20260709160000';

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
        PERFORM pg_notify('app_changes', v_payload::text);
        RETURN v_row;
      END;
      $$;
    `);

    for (const table of [
      'notifications',
      'agent_handoffs',
      'voice_calls',
      'contacts',
    ]) {
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
    for (const table of [
      'notifications',
      'agent_handoffs',
      'voice_calls',
      'contacts',
    ]) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.${table};`,
      );
    }
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS public.notify_app_changes();`,
    );
  }
}
