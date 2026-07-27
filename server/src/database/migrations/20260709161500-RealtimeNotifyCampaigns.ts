import { MigrationInterface, QueryRunner } from 'typeorm';

// Extends 20260709160000-RealtimeNotify.ts's notify_app_changes() trigger to
// voice_campaigns/voice_campaign_contacts, completing the 6th (and last)
// postgres_changes consumer from the migration plan's inventory
// (campanhas.$campaignId.tsx, filtered by campaign — voice_campaign_contacts
// carries campaign_id but no dedicated "campaignId" routing key is needed
// since the client already filters client-side on the ported route, same
// as the other 4 tables).
export class RealtimeNotifyCampaigns20260709161500 implements MigrationInterface {
  name = 'RealtimeNotifyCampaigns20260709161500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['voice_campaigns', 'voice_campaign_contacts']) {
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
    for (const table of ['voice_campaigns', 'voice_campaign_contacts']) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS trg_notify_app_changes ON public.${table};`,
      );
    }
  }
}
