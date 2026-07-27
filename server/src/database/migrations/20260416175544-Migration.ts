import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416175544_941777cf-0b52-4e45-9f6e-712c2ba03dae.sql.
export class Migration20260416175544 implements MigrationInterface {
  name = 'Migration20260416175544';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- conversation_outcomes
CREATE TABLE public.conversation_outcomes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  outcome_type varchar(40) NOT NULL,
  value real,
  currency varchar(8) DEFAULT 'BRL',
  source varchar(20) NOT NULL DEFAULT 'manual',
  confidence real NOT NULL DEFAULT 1.0,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_co_account ON public.conversation_outcomes(account_id, observed_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_co_conversation ON public.conversation_outcomes(conversation_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_co_type ON public.conversation_outcomes(account_id, outcome_type);
`);
    await queryRunner.query(`
ALTER TABLE public.conversation_outcomes ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY co_select_member ON public.conversation_outcomes FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY co_insert_member ON public.conversation_outcomes FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY co_update_member ON public.conversation_outcomes FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY co_delete_admin ON public.conversation_outcomes FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- outcome_attributions
CREATE TABLE public.outcome_attributions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  outcome_id bigint NOT NULL REFERENCES public.conversation_outcomes(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  prompt_version_id bigint REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  weight real NOT NULL DEFAULT 1.0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_oa_outcome ON public.outcome_attributions(outcome_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_oa_persona ON public.outcome_attributions(persona_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_oa_prompt ON public.outcome_attributions(prompt_version_id);
`);
    await queryRunner.query(`
ALTER TABLE public.outcome_attributions ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY oa_select_member ON public.outcome_attributions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversation_outcomes co WHERE co.id = outcome_attributions.outcome_id AND is_account_member(auth.uid(), co.account_id))
);
`);
    await queryRunner.query(`
CREATE POLICY oa_insert_member ON public.outcome_attributions FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.conversation_outcomes co WHERE co.id = outcome_attributions.outcome_id AND is_account_member(auth.uid(), co.account_id))
);
`);
    await queryRunner.query(`
CREATE POLICY oa_delete_admin ON public.outcome_attributions FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.conversation_outcomes co WHERE co.id = outcome_attributions.outcome_id AND has_role(auth.uid(), co.account_id, 'admin'::app_role))
);
`);
    await queryRunner.query(`
-- csat_surveys
CREATE TABLE public.csat_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  rating int CHECK (rating BETWEEN 1 AND 5),
  feedback text,
  handler_type varchar(20),
  handler_id uuid,
  status varchar(20) NOT NULL DEFAULT 'pending',
  sent_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours')
);
`);
    await queryRunner.query(`
CREATE INDEX idx_csat_account ON public.csat_surveys(account_id, status);
`);
    await queryRunner.query(`
CREATE INDEX idx_csat_conversation ON public.csat_surveys(conversation_id);
`);
    await queryRunner.query(`
ALTER TABLE public.csat_surveys ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY csat_select_member ON public.csat_surveys FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY csat_insert_member ON public.csat_surveys FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY csat_update_member ON public.csat_surveys FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY csat_delete_admin ON public.csat_surveys FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- Trigger: auto-create CSAT survey when conversation resolved
CREATE OR REPLACE FUNCTION public.tg_create_csat_on_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_handler_type varchar(20);
  v_handler_id uuid;
  v_last_msg record;
BEGIN
  IF NEW.status = 1 AND (OLD.status IS NULL OR OLD.status <> 1) AND NEW.contact_id IS NOT NULL THEN
    SELECT sender_type, sender_id INTO v_last_msg
    FROM public.messages
    WHERE conversation_id = NEW.id AND message_type = 1
    ORDER BY created_at DESC LIMIT 1;

    v_handler_type := CASE WHEN v_last_msg.sender_type = 'AgentBot' THEN 'ai' ELSE 'human' END;
    v_handler_id := v_last_msg.sender_id;

    INSERT INTO public.csat_surveys (account_id, conversation_id, contact_id, handler_type, handler_id)
    VALUES (NEW.account_id, NEW.id, NEW.contact_id, v_handler_type, v_handler_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_conversations_csat
AFTER UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.tg_create_csat_on_resolve();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416175544 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
