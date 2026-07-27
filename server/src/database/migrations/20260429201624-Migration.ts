import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260429201624_c988bf8e-814f-458d-80fd-a666a4b30d64.sql.
export class Migration20260429201624 implements MigrationInterface {
  name = 'Migration20260429201624';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- 1. Tabela de médicos da clínica (entidades configuráveis pelo admin, não usuários do Nexus)
CREATE TABLE IF NOT EXISTS public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  specialty text,
  modalities text[] NOT NULL DEFAULT ARRAY['presencial']::text[],
  default_duration_minutes int NOT NULL DEFAULT 30,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_doctors_account_active ON public.doctors(account_id, active);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON public.doctors(account_id, specialty);
`);
    await queryRunner.query(`
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctors_select_member" ON public.doctors;
`);
    await queryRunner.query(`
CREATE POLICY "doctors_select_member" ON public.doctors
  FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctors_admin_write" ON public.doctors;
`);
    await queryRunner.query(`
CREATE POLICY "doctors_admin_write" ON public.doctors
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_doctors_updated_at ON public.doctors;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_doctors_updated_at
  BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
-- 2. Janelas semanais por médico
CREATE TABLE IF NOT EXISTS public.doctor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_doctor_avail_doctor ON public.doctor_availability(doctor_id, weekday);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_doctor_avail_account ON public.doctor_availability(account_id);
`);
    await queryRunner.query(`
ALTER TABLE public.doctor_availability ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctor_avail_select_member" ON public.doctor_availability;
`);
    await queryRunner.query(`
CREATE POLICY "doctor_avail_select_member" ON public.doctor_availability
  FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctor_avail_admin_write" ON public.doctor_availability;
`);
    await queryRunner.query(`
CREATE POLICY "doctor_avail_admin_write" ON public.doctor_availability
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- 3. Bloqueios pontuais (folgas, feriados, viagens)
CREATE TABLE IF NOT EXISTS public.doctor_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_doctor_blocks_doctor ON public.doctor_blocks(doctor_id, starts_at);
`);
    await queryRunner.query(`
ALTER TABLE public.doctor_blocks ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctor_blocks_select_member" ON public.doctor_blocks;
`);
    await queryRunner.query(`
CREATE POLICY "doctor_blocks_select_member" ON public.doctor_blocks
  FOR SELECT TO authenticated
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
DROP POLICY IF EXISTS "doctor_blocks_admin_write" ON public.doctor_blocks;
`);
    await queryRunner.query(`
CREATE POLICY "doctor_blocks_admin_write" ON public.doctor_blocks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- 4. Adiciona doctor_id e modality em scheduled_meetings (mantém attendee_user_id para back-compat)
ALTER TABLE public.scheduled_meetings
  ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES public.doctors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS modality text;
`);
    await queryRunner.query(`
CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_doctor
  ON public.scheduled_meetings(doctor_id, starts_at)
  WHERE doctor_id IS NOT NULL;
`);
    await queryRunner.query(`
-- 5. Helpers RPC: list/upsert/delete doctors + set availability
CREATE OR REPLACE FUNCTION public.doctors_list(p_account_id uuid)
RETURNS TABLE (
  id uuid, name text, specialty text, modalities text[],
  default_duration_minutes int, notes text, active boolean,
  weekly_slots jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_account_member(auth.uid(), p_account_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT
    d.id, d.name, d.specialty, d.modalities,
    d.default_duration_minutes, d.notes, d.active,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'weekday', a.weekday,
        'start_time', a.start_time::text,
        'end_time', a.end_time::text
      ) ORDER BY a.weekday, a.start_time)
      FROM public.doctor_availability a WHERE a.doctor_id = d.id
    ), '[]'::jsonb) AS weekly_slots
  FROM public.doctors d
  WHERE d.account_id = p_account_id
  ORDER BY d.active DESC, d.name;
END;
$$;
`);
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.doctor_set_availability(
  p_account_id uuid, p_doctor_id uuid, p_slots jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_slot jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), p_account_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.doctors WHERE id = p_doctor_id AND account_id = p_account_id) THEN
    RAISE EXCEPTION 'doctor not in account';
  END IF;
  DELETE FROM public.doctor_availability WHERE doctor_id = p_doctor_id;
  FOR v_slot IN SELECT jsonb_array_elements(p_slots) LOOP
    INSERT INTO public.doctor_availability(account_id, doctor_id, weekday, start_time, end_time)
    VALUES (
      p_account_id, p_doctor_id,
      (v_slot->>'weekday')::smallint,
      (v_slot->>'start_time')::time,
      (v_slot->>'end_time')::time
    );
  END LOOP;
END;
$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260429201624 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
