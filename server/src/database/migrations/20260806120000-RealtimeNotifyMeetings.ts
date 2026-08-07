import { MigrationInterface, QueryRunner } from 'typeorm';

// Extends 20260709160000-RealtimeNotify.ts's notify_app_changes() trigger to
// scheduled_meetings — the Reuniões page had no live updates: creating or
// changing a meeting (manually or via the AI agent) required a manual
// refresh to show up.
export class RealtimeNotifyMeetings20260806120000
  implements MigrationInterface
{
  name = 'RealtimeNotifyMeetings20260806120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.scheduled_meetings;`,
    );
    await queryRunner.query(`
      CREATE TRIGGER trg_notify_app_changes
        AFTER INSERT OR UPDATE OR DELETE ON public.scheduled_meetings
        FOR EACH ROW EXECUTE FUNCTION public.notify_app_changes();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.scheduled_meetings;`,
    );
  }
}
