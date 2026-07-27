import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423165206_527a0842-a375-4d5d-9cad-76577545d9b7.sql.
export class Migration20260423165206 implements MigrationInterface {
  name = 'Migration20260423165206';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.phone_numbers
ADD COLUMN IF NOT EXISTS elevenlabs_phone_number_id text;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423165206 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
