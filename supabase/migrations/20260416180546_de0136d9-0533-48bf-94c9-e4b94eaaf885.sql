
CREATE TABLE public.live_sessions (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  current_speaker_type VARCHAR(16) NOT NULL DEFAULT 'ai',
  current_speaker_id UUID,
  pinned_persona_id UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  participants JSONB NOT NULL DEFAULT '[]'::jsonb,
  live_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  rtc_channel VARCHAR(255),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conversation_id)
);
CREATE INDEX idx_live_sessions_account_active ON public.live_sessions(account_id) WHERE ended_at IS NULL;
ALTER TABLE public.live_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ls_select_member ON public.live_sessions FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY ls_insert_member ON public.live_sessions FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY ls_update_member ON public.live_sessions FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY ls_delete_admin ON public.live_sessions FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TABLE public.live_takeovers (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES public.live_sessions(id) ON DELETE CASCADE,
  from_type VARCHAR(16) NOT NULL,
  from_id UUID,
  to_type VARCHAR(16) NOT NULL,
  to_id UUID,
  reason VARCHAR(64) NOT NULL DEFAULT 'manual',
  visible_to_customer BOOLEAN NOT NULL DEFAULT false,
  at_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_live_takeovers_session ON public.live_takeovers(session_id, created_at DESC);
ALTER TABLE public.live_takeovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY lt_select_member ON public.live_takeovers FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.live_sessions s WHERE s.id = live_takeovers.session_id AND is_account_member(auth.uid(), s.account_id))
);
CREATE POLICY lt_insert_member ON public.live_takeovers FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.live_sessions s WHERE s.id = live_takeovers.session_id AND is_account_member(auth.uid(), s.account_id))
);

CREATE TABLE public.conversation_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  branched_from_id BIGINT REFERENCES public.conversation_checkpoints(id) ON DELETE SET NULL,
  branch_note TEXT,
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_checkpoints_conv ON public.conversation_checkpoints(conversation_id, created_at DESC);
ALTER TABLE public.conversation_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY cc_select_member ON public.conversation_checkpoints FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY cc_insert_member ON public.conversation_checkpoints FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY cc_delete_admin ON public.conversation_checkpoints FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TABLE public.conversation_replays (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  original_conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  checkpoint_id BIGINT REFERENCES public.conversation_checkpoints(id) ON DELETE SET NULL,
  edited_message TEXT NOT NULL,
  persona_id UUID REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  simulated_outcome VARCHAR(32),
  outcome_score REAL,
  outcome_delta REAL,
  judge_notes TEXT,
  cost_cents REAL NOT NULL DEFAULT 0,
  created_by_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_replays_conv ON public.conversation_replays(original_conversation_id, created_at DESC);
ALTER TABLE public.conversation_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY cr_select_member ON public.conversation_replays FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY cr_insert_member ON public.conversation_replays FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY cr_update_member ON public.conversation_replays FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY cr_delete_admin ON public.conversation_replays FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

ALTER PUBLICATION supabase_realtime ADD TABLE public.live_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_takeovers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_replays;
