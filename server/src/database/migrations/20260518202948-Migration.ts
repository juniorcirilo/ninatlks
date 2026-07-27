import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260518202948_8b1526d7-0f7c-4216-be0c-6a47947233d2.sql.
export class Migration20260518202948 implements MigrationInterface {
  name = 'Migration20260518202948';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
INSERT INTO storage.buckets (id, name, public)
VALUES ('quote-pdfs', 'quote-pdfs', false)
ON CONFLICT (id) DO NOTHING;
`);
    await queryRunner.query(`
-- path layout: {account_id}/{quote_id}.pdf
CREATE POLICY "quote_pdfs_select_account_members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'quote-pdfs'
  AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
    await queryRunner.query(`
CREATE POLICY "quote_pdfs_insert_account_members"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'quote-pdfs'
  AND public.is_account_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260518202948 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
