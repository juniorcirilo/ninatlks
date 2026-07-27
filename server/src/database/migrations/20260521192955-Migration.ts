import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260521192955_3d96b31e-7ddb-4001-b431-e3a5a04cde6a.sql.
export class Migration20260521192955 implements MigrationInterface {
  name = 'Migration20260521192955';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE public.contact_lifecycle_stage AS ENUM ('lead','prospect','customer','inactive','delinquent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE public.contact_operational_status AS ENUM (
    'new','sdr','qualifying','negotiating','closed_won','closed_lost',
    'collections','post_sale','retention','no_response','do_not_contact'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
    await queryRunner.query(`
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage public.contact_lifecycle_stage NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS operational_status public.contact_operational_status NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_call_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_whatsapp_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON public.contacts(account_id, lifecycle_stage);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contacts_op_status ON public.contacts(account_id, operational_status);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON public.contacts(account_id, owner_user_id);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_contacts_last_activity ON public.contacts(account_id, last_activity_at DESC);
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260521192955 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
