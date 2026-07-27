import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424231601_1f41b12d-f695-4eac-b1a9-b8b4d52367c8.sql.
export class Migration20260424231601 implements MigrationInterface {
  name = 'Migration20260424231601';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter type public.arrangement_status add value if not exists 'pendente_aprovacao' before 'pendente';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424231601 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
