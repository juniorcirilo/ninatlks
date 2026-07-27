import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423220451_bbf53233-a37b-4687-9bc9-2852bddb6b02.sql.
export class Migration20260423220451 implements MigrationInterface {
  name = 'Migration20260423220451';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.voice_calls ADD COLUMN IF NOT EXISTS source_id text;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS voice_calls_source_id_idx 
  ON public.voice_calls(source_id) WHERE source_id IS NOT NULL;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260423220451 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
