import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426232138_08b8bfee-c878-48f1-8bf8-0899a8137e1c.sql.
export class Migration20260426232138 implements MigrationInterface {
  name = 'Migration20260426232138';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.messages REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END $guard$;
`);
    await queryRunner.query(`
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations';
  END IF;
END $guard$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426232138 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
