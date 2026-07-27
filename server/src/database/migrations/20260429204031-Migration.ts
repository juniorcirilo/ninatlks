import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260429204031_719021b7-8b53-44a1-9716-e05c87ebe9ef.sql.
export class Migration20260429204031 implements MigrationInterface {
  name = 'Migration20260429204031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- [no-op for local introspection: data backfill for a specific real account_id, no schema impact]
SELECT 1;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260429204031 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
