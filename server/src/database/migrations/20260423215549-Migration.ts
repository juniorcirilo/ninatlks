import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423215549_d59ef4aa-d402-4082-8d2e-7c8b787678a7.sql.
export class Migration20260423215549 implements MigrationInterface {
  name = 'Migration20260423215549';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE public.phone_numbers SET enabled = true, outbound_enabled = true WHERE NOT (enabled AND outbound_enabled);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423215549 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
