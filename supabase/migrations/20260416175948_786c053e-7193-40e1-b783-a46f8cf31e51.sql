
-- ── eval_scenarios ──────────────────────────────────────────────
CREATE TABLE public.eval_scenarios (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  customer_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal text NOT NULL,
  hidden_traits jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria text NOT NULL DEFAULT '',
  difficulty real NOT NULL DEFAULT 0.5,
  source varchar(30) NOT NULL DEFAULT 'manual',
  source_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_scenarios_account ON public.eval_scenarios(account_id);
CREATE TRIGGER trg_eval_scenarios_updated_at BEFORE UPDATE ON public.eval_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.eval_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY es_select_member ON public.eval_scenarios FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY es_insert_member ON public.eval_scenarios FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY es_update_member ON public.eval_scenarios FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY es_delete_admin ON public.eval_scenarios FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

-- ── eval_runs ──────────────────────────────────────────────────
CREATE TABLE public.eval_runs (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt_version_id bigint REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  baseline_prompt_version_id bigint REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'queued',
  scenario_count int NOT NULL DEFAULT 0,
  conversations_run int NOT NULL DEFAULT 0,
  win_rate real,
  avg_outcome_score real,
  avg_turns real,
  avg_latency_ms real,
  total_cost_cents real NOT NULL DEFAULT 0,
  verdict varchar(20),
  verdict_reason text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_runs_account ON public.eval_runs(account_id, created_at DESC);
CREATE INDEX idx_eval_runs_persona ON public.eval_runs(persona_id, created_at DESC);
CREATE TRIGGER trg_eval_runs_updated_at BEFORE UPDATE ON public.eval_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY er_select_member ON public.eval_runs FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY er_insert_member ON public.eval_runs FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY er_update_member ON public.eval_runs FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY er_delete_admin ON public.eval_runs FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

-- ── eval_conversations ─────────────────────────────────────────
CREATE TABLE public.eval_conversations (
  id bigserial PRIMARY KEY,
  eval_run_id bigint NOT NULL REFERENCES public.eval_runs(id) ON DELETE CASCADE,
  scenario_id bigint NOT NULL REFERENCES public.eval_scenarios(id) ON DELETE CASCADE,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  turns int NOT NULL DEFAULT 0,
  outcome varchar(20),
  outcome_score real,
  judge_notes text,
  decisive_turn_index int,
  cost_cents real NOT NULL DEFAULT 0,
  duration_ms int,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (eval_run_id, scenario_id)
);
CREATE INDEX idx_eval_conv_run ON public.eval_conversations(eval_run_id);

ALTER TABLE public.eval_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ec_select_member ON public.eval_conversations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.eval_runs r WHERE r.id = eval_run_id AND is_account_member(auth.uid(), r.account_id))
);
CREATE POLICY ec_insert_member ON public.eval_conversations FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.eval_runs r WHERE r.id = eval_run_id AND is_account_member(auth.uid(), r.account_id))
);
CREATE POLICY ec_delete_admin ON public.eval_conversations FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.eval_runs r WHERE r.id = eval_run_id AND has_role(auth.uid(), r.account_id, 'admin'::app_role))
);

-- ── persona_improvement_attempts ───────────────────────────────
CREATE TABLE public.persona_improvement_attempts (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  baseline_prompt_version_id bigint REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  candidate_prompt_version_id bigint REFERENCES public.prompt_versions(id) ON DELETE SET NULL,
  eval_run_id bigint REFERENCES public.eval_runs(id) ON DELETE SET NULL,
  change_summary text,
  why text,
  status varchar(20) NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pia_persona ON public.persona_improvement_attempts(persona_id, created_at DESC);

ALTER TABLE public.persona_improvement_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pia_select_member ON public.persona_improvement_attempts FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY pia_insert_member ON public.persona_improvement_attempts FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY pia_delete_admin ON public.persona_improvement_attempts FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));
