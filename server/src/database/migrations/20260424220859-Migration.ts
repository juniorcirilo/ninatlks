import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424220859_539e84bd-f92b-493c-875b-ac8388e01da9.sql.
export class Migration20260424220859 implements MigrationInterface {
  name = 'Migration20260424220859';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.agent_personas ALTER COLUMN source_user_id DROP NOT NULL;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424220859 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
