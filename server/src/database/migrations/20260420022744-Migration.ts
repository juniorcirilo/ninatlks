import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260420022744_9d7e46a0-6404-44b3-9f43-e15703a32cb3.sql.
export class Migration20260420022744 implements MigrationInterface {
  name = 'Migration20260420022744';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================================
-- WORKFLOW ENGINE — Phase 1 schema
-- ============================================================================

-- 1) workflows: definitions
CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_workflows_account_enabled
  ON public.workflows (account_id, enabled, trigger_type)
  WHERE enabled = true;
`);
    await queryRunner.query(`
CREATE TRIGGER tg_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "members read workflows"
  ON public.workflows FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "admins write workflows"
  ON public.workflows FOR ALL
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- 2) workflow_runs: execution history
CREATE TABLE public.workflow_runs (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  event_id bigint,
  trigger_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  error_action_index integer,
  duration_ms integer,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_workflow_runs_workflow_status
  ON public.workflow_runs (workflow_id, status, created_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_workflow_runs_pending
  ON public.workflow_runs (scheduled_at)
  WHERE status = 'pending';
`);
    await queryRunner.query(`
CREATE INDEX idx_workflow_runs_account_date
  ON public.workflow_runs (account_id, created_at DESC);
`);
    await queryRunner.query(`
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "members read workflow runs"
  ON public.workflow_runs FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- (writes are service-role only — no INSERT/UPDATE policies for end users)

-- 3) workflow_events: internal event bus
CREATE TABLE public.workflow_events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  source text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  matched_workflow_count integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_workflow_events_account_type_date
  ON public.workflow_events (account_id, event_type, created_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_workflow_events_unprocessed
  ON public.workflow_events (created_at)
  WHERE processed_at IS NULL;
`);
    await queryRunner.query(`
ALTER TABLE public.workflow_events ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "members read workflow events"
  ON public.workflow_events FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
-- 4) contact_tags
CREATE TABLE public.contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  color text,
  description text,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, tag)
);
`);
    await queryRunner.query(`
CREATE INDEX idx_contact_tags_account_tag ON public.contact_tags (account_id, tag);
`);
    await queryRunner.query(`
CREATE INDEX idx_contact_tags_contact ON public.contact_tags (contact_id);
`);
    await queryRunner.query(`
ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "members read contact tags"
  ON public.contact_tags FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "admins write contact tags"
  ON public.contact_tags FOR ALL
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- ============================================================================
-- DB TRIGGERS that emit workflow_events
-- ============================================================================

-- 5a) outcome.created
CREATE OR REPLACE FUNCTION public.tg_emit_outcome_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
BEGIN
  INSERT INTO public.workflow_events (account_id, source, event_type, payload, contact_id, conversation_id)
  VALUES (
    NEW.account_id,
    'system',
    'outcome.created',
    jsonb_build_object(
      'outcome_id', NEW.id,
      'outcome_type', NEW.outcome_type,
      'value', NEW.value,
      'currency', NEW.currency,
      'confidence', NEW.confidence,
      'metadata', NEW.metadata
    ),
    NEW.contact_id,
    NEW.conversation_id
  );
  RETURN NEW;
END;
$fn$;
`);
    await queryRunner.query(`
CREATE TRIGGER tg_outcome_created_emit
  AFTER INSERT ON public.conversation_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_outcome_created();
`);
    await queryRunner.query(`
-- 5b) conversation.resolved
CREATE OR REPLACE FUNCTION public.tg_emit_conversation_resolved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
BEGIN
  IF NEW.status = 1 AND (OLD.status IS NULL OR OLD.status <> 1) THEN
    INSERT INTO public.workflow_events (account_id, source, event_type, payload, contact_id, conversation_id)
    VALUES (
      NEW.account_id,
      'system',
      'conversation.resolved',
      jsonb_build_object(
        'conversation_id', NEW.id,
        'inbox_id', NEW.inbox_id,
        'assignee_id', NEW.assignee_id,
        'display_id', NEW.display_id
      ),
      NEW.contact_id,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$fn$;
`);
    await queryRunner.query(`
CREATE TRIGGER tg_conversation_resolved_emit
  AFTER UPDATE OF status ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_conversation_resolved();
`);
    await queryRunner.query(`
-- 5c) contact.tag_added
CREATE OR REPLACE FUNCTION public.tg_emit_contact_tag_added()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
BEGIN
  INSERT INTO public.workflow_events (account_id, source, event_type, payload, contact_id)
  VALUES (
    NEW.account_id,
    'system',
    'contact.tag_added',
    jsonb_build_object(
      'tag', NEW.tag,
      'color', NEW.color
    ),
    NEW.contact_id
  );
  RETURN NEW;
END;
$fn$;
`);
    await queryRunner.query(`
CREATE TRIGGER tg_contact_tag_added_emit
  AFTER INSERT ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_contact_tag_added();
`);
    await queryRunner.query(`
-- ============================================================================
-- RPC: bump_workflow_counters
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bump_workflow_counters(
  p_workflow_id uuid,
  p_success integer DEFAULT 0,
  p_failure integer DEFAULT 0
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
BEGIN
  UPDATE public.workflows
     SET success_count = success_count + COALESCE(p_success, 0),
         failure_count = failure_count + COALESCE(p_failure, 0),
         last_run_at   = now(),
         updated_at    = now()
   WHERE id = p_workflow_id;
END;
$fn$;
`);
    await queryRunner.query(`
-- ============================================================================
-- Realtime: REPLICA IDENTITY + publication
-- ============================================================================
ALTER TABLE public.workflows REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
ALTER TABLE public.workflow_runs REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflows;
`);
    await queryRunner.query(`
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_runs;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260420022744 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
