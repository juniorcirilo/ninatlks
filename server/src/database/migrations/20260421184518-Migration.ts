import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421184518_a78bb228-7d04-4250-a837-cc500826b3da.sql.
export class Migration20260421184518 implements MigrationInterface {
  name = 'Migration20260421184518';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS last_customer_msg_at TIMESTAMP WITH TIME ZONE;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_conversations_last_customer_msg_at
  ON public.conversations(last_customer_msg_at);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260421184518 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
