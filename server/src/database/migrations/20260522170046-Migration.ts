import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260522170046_60cbd599-0e95-4192-aa14-3c7104f2487b.sql.
export class Migration20260522170046 implements MigrationInterface {
  name = 'Migration20260522170046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.voice_campaigns DROP CONSTRAINT IF EXISTS voice_campaigns_campaign_kind_check;
`);
    await queryRunner.query(`
ALTER TABLE public.voice_campaigns ADD CONSTRAINT voice_campaigns_campaign_kind_check
  CHECK (campaign_kind IS NULL OR campaign_kind = ANY (ARRAY['sdr','pos_venda','cobranca','retencao','custom','collection','other']));
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260522170046 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
