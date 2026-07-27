import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260518194958_5ad8e276-0b09-444d-a4ae-cd2ea9b986df.sql.
export class Migration20260518194958 implements MigrationInterface {
  name = 'Migration20260518194958';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
DO $$ BEGIN
  CREATE TYPE public.agent_role_kind AS ENUM ('sdr', 'orcamentista', 'suporte', 'cobranca', 'concierge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.agent_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  kind public.agent_role_kind NOT NULL,
  display_name text NOT NULL,
  description text,
  allowed_tools text[] NOT NULL DEFAULT ARRAY[]::text[],
  handoff_targets uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  handoff_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  daily_message_budget integer NOT NULL DEFAULT 500,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id)
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_agent_roles_account ON public.agent_roles(account_id);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_agent_roles_kind ON public.agent_roles(account_id, kind);
`);
    await queryRunner.query(`
ALTER TABLE public.agent_roles ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "agent_roles_select_member" ON public.agent_roles
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "agent_roles_admin_all" ON public.agent_roles
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE TRIGGER set_agent_roles_updated_at BEFORE UPDATE ON public.agent_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.agent_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  from_persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  to_persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  to_human_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_persona_id IS NOT NULL OR to_human_user_id IS NOT NULL)
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_handoffs_conv ON public.agent_handoffs(conversation_id, created_at DESC);
`);
    await queryRunner.query(`
ALTER TABLE public.agent_handoffs ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "handoffs_select_member" ON public.agent_handoffs
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "handoffs_insert_member" ON public.agent_handoffs
  FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.glass_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  thickness_mm numeric(5,2) NOT NULL,
  color text NOT NULL DEFAULT 'incolor',
  price_per_m2 numeric(10,2) NOT NULL,
  min_m2_per_piece numeric(6,2) NOT NULL DEFAULT 0.5,
  nbr_reference text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sku)
);
`);
    await queryRunner.query(`
CREATE TABLE IF NOT EXISTS public.glass_fittings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  unit text NOT NULL DEFAULT 'un',
  price numeric(10,2) NOT NULL,
  compatible_thickness_mm numeric[] NOT NULL DEFAULT ARRAY[]::numeric[],
  finish text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, sku)
);
`);
    await queryRunner.query(`
ALTER TABLE public.glass_types ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
ALTER TABLE public.glass_fittings ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "glass_types_select_member" ON public.glass_types
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "glass_types_admin" ON public.glass_types
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE POLICY "glass_fittings_select_member" ON public.glass_fittings
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "glass_fittings_admin" ON public.glass_fittings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
CREATE TRIGGER set_glass_types_updated_at BEFORE UPDATE ON public.glass_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
CREATE TRIGGER set_glass_fittings_updated_at BEFORE UPDATE ON public.glass_fittings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
DO $$
DECLARE acc uuid;
BEGIN
  SELECT id INTO acc FROM public.accounts ORDER BY created_at ASC LIMIT 1;
  IF acc IS NULL THEN RETURN; END IF;

  INSERT INTO public.glass_types (account_id, sku, name, category, thickness_mm, price_per_m2, nbr_reference) VALUES
    (acc, 'TEMP-6-INC',  'Vidro Temperado Incolor 6mm',  'temperado', 6.00,  290.00, 'NBR 14698'),
    (acc, 'TEMP-8-INC',  'Vidro Temperado Incolor 8mm',  'temperado', 8.00,  390.00, 'NBR 14698'),
    (acc, 'TEMP-10-INC', 'Vidro Temperado Incolor 10mm', 'temperado', 10.00, 520.00, 'NBR 14698'),
    (acc, 'LAM-44-INC',  'Vidro Laminado 4+4mm Incolor', 'laminado',  8.00,  450.00, 'NBR 7199'),
    (acc, 'LAM-55-INC',  'Vidro Laminado 5+5mm Incolor', 'laminado',  10.00, 580.00, 'NBR 7199'),
    (acc, 'ESP-4',       'Espelho 4mm',                  'espelho',   4.00,  240.00, NULL)
  ON CONFLICT (account_id, sku) DO NOTHING;

  INSERT INTO public.glass_fittings (account_id, sku, name, category, unit, price, compatible_thickness_mm, finish) VALUES
    (acc, 'DOB-BOX-CR',  'Dobradiça Box Cromada',      'dobradica', 'un',  85.00, ARRAY[8,10]::numeric[], 'cromado'),
    (acc, 'PUX-H-30-CR', 'Puxador H 30cm Cromado',     'puxador',   'un', 165.00, ARRAY[8,10]::numeric[], 'cromado'),
    (acc, 'FEC-BOX-CR',  'Fechadura Box Cromada',      'fechadura', 'un', 120.00, ARRAY[8,10]::numeric[], 'cromado'),
    (acc, 'KIT-BOX-PAD', 'Kit Box Padrão (sem vidro)', 'kit',       'un', 520.00, ARRAY[8,10]::numeric[], 'cromado'),
    (acc, 'PERF-U-INOX', 'Perfil U Inox (por metro)',  'perfil',    'm',   45.00, ARRAY[8,10]::numeric[], 'inox')
  ON CONFLICT (account_id, sku) DO NOTHING;
END $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260518194958 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
