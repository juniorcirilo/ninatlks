import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419160000_voice_campaigns_cron.sql.
export class VoiceCampaignsCron20260419160000 implements MigrationInterface {
  name = 'VoiceCampaignsCron20260419160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Cron that picks up queued voice_campaign_contacts and places the calls.
select public.schedule_edge_cron(
  'nexus-voice-campaign-dispatch',
  '* * * * *',
  'voice-campaign-dispatch',
  '{}'::jsonb
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'VoiceCampaignsCron20260419160000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
