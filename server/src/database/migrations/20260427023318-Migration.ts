import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260427023318_4c7915f7-a33e-438e-93a1-2f93714758db.sql.
export class Migration20260427023318 implements MigrationInterface {
  name = 'Migration20260427023318';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Permite vincular acordos a conversas de WhatsApp/Chat (não só voice_calls)
ALTER TABLE public.payment_arrangements
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_payment_arrangements_conversation_id
  ON public.payment_arrangements(conversation_id)
  WHERE conversation_id IS NOT NULL;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260427023318 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
