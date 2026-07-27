
DO $$ BEGIN
  CREATE TYPE public.contact_lifecycle_stage AS ENUM ('lead','prospect','customer','inactive','delinquent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.contact_operational_status AS ENUM (
    'new','sdr','qualifying','negotiating','closed_won','closed_lost',
    'collections','post_sale','retention','no_response','do_not_contact'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage public.contact_lifecycle_stage NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS operational_status public.contact_operational_status NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_call_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_whatsapp_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON public.contacts(account_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_op_status ON public.contacts(account_id, operational_status);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON public.contacts(account_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_last_activity ON public.contacts(account_id, last_activity_at DESC);
