import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416174424_e81b2aeb-46d2-4cc1-84e8-82c064027924.sql.
export class Migration20260416174424 implements MigrationInterface {
  name = 'Migration20260416174424';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Expand agent_personas with style + voice fields
ALTER TABLE public.agent_personas
  ADD COLUMN IF NOT EXISTS style_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS voice_provider varchar,
  ADD COLUMN IF NOT EXISTS voice_clone_id varchar,
  ADD COLUMN IF NOT EXISTS voice_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
`);
    await queryRunner.query(`
-- Add 'training' to persona_status enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'training' AND enumtypid = 'persona_status'::regtype) THEN
    ALTER TYPE persona_status ADD VALUE 'training';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'retired' AND enumtypid = 'persona_status'::regtype) THEN
    ALTER TYPE persona_status ADD VALUE 'retired';
  END IF;
END$$;
`);
    await queryRunner.query(`
-- agent_persona_samples
CREATE TABLE public.agent_persona_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  text text NOT NULL,
  representativeness real NOT NULL DEFAULT 0.5,
  category varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_aps_persona ON public.agent_persona_samples (persona_id);
`);
    await queryRunner.query(`
ALTER TABLE public.agent_persona_samples ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "aps_select_member" ON public.agent_persona_samples
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agent_personas p WHERE p.id = agent_persona_samples.persona_id AND is_account_member(auth.uid(), p.account_id)));
`);
    await queryRunner.query(`
CREATE POLICY "aps_insert_admin" ON public.agent_persona_samples
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.agent_personas p WHERE p.id = agent_persona_samples.persona_id AND has_role(auth.uid(), p.account_id, 'admin')));
`);
    await queryRunner.query(`
CREATE POLICY "aps_delete_admin" ON public.agent_persona_samples
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.agent_personas p WHERE p.id = agent_persona_samples.persona_id AND has_role(auth.uid(), p.account_id, 'admin')));
`);
    await queryRunner.query(`
-- agent_persona_deployments
CREATE TABLE public.agent_persona_deployments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  persona_id uuid NOT NULL REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES public.inboxes(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  mode varchar NOT NULL DEFAULT 'always' CHECK (mode IN ('always','after_hours','overflow','shadow','cron')),
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  autonomy varchar NOT NULL DEFAULT 'suggest' CHECK (autonomy IN ('auto','suggest','shadow')),
  confidence_threshold real NOT NULL DEFAULT 0.7,
  daily_message_budget integer NOT NULL DEFAULT 100,
  messages_sent_today integer NOT NULL DEFAULT 0,
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, inbox_id)
);
`);
    await queryRunner.query(`
CREATE INDEX idx_apd_account_inbox ON public.agent_persona_deployments (account_id, inbox_id);
`);
    await queryRunner.query(`
ALTER TABLE public.agent_persona_deployments ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "apd_select_member" ON public.agent_persona_deployments
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "apd_insert_admin" ON public.agent_persona_deployments
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
CREATE POLICY "apd_update_admin" ON public.agent_persona_deployments
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
CREATE POLICY "apd_delete_admin" ON public.agent_persona_deployments
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
CREATE TRIGGER update_apd_updated_at
  BEFORE UPDATE ON public.agent_persona_deployments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416174424 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
