import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421175355_442ecb3f-4edd-4245-869c-f6f9cb758852.sql.
export class Migration20260421175355 implements MigrationInterface {
  name = 'Migration20260421175355';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE public.channels
SET config = config || '{"zernio_username":"ghmbarboza","zernio_account_id":"69e7aa337dea335c2b1cdc74"}'::jsonb,
    updated_at = now()
WHERE id = '84a17c7b-ec2d-4faa-ae4c-bc29ef44ed3d';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260421175355 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
