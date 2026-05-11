
-- conversation_signals
CREATE TABLE public.conversation_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  kind varchar(40) NOT NULL,
  severity real NOT NULL DEFAULT 0.5,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action varchar(40),
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_signals_conv ON public.conversation_signals(conversation_id, detected_at DESC);
CREATE INDEX idx_signals_account_severity ON public.conversation_signals(account_id, severity DESC, detected_at DESC);
CREATE INDEX idx_signals_kind ON public.conversation_signals(account_id, kind, detected_at DESC);

ALTER TABLE public.conversation_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY cs_select_member ON public.conversation_signals FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
CREATE POLICY cs_insert_member ON public.conversation_signals FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY cs_delete_admin ON public.conversation_signals FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));

-- incident_clusters
CREATE TABLE public.incident_clusters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  summary text NOT NULL DEFAULT '',
  contact_count integer NOT NULL DEFAULT 0,
  conversation_count integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'detected',
  severity varchar(10) NOT NULL DEFAULT 'low',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_by_id uuid,
  acknowledged_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clusters_account_status ON public.incident_clusters(account_id, status, last_seen_at DESC);

ALTER TABLE public.incident_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY ic_select_member ON public.incident_clusters FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
CREATE POLICY ic_insert_member ON public.incident_clusters FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY ic_update_member ON public.incident_clusters FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));
CREATE POLICY ic_delete_admin ON public.incident_clusters FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER tg_incident_clusters_updated BEFORE UPDATE ON public.incident_clusters
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- incident_cluster_members
CREATE TABLE public.incident_cluster_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cluster_id bigint NOT NULL REFERENCES public.incident_clusters(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  match_score real NOT NULL DEFAULT 0.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, conversation_id)
);
CREATE INDEX idx_cluster_members_cluster ON public.incident_cluster_members(cluster_id);

ALTER TABLE public.incident_cluster_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY icm_select_member ON public.incident_cluster_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.incident_clusters c WHERE c.id = cluster_id AND is_account_member(auth.uid(), c.account_id)));
CREATE POLICY icm_insert_member ON public.incident_cluster_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.incident_clusters c WHERE c.id = cluster_id AND is_account_member(auth.uid(), c.account_id)));
CREATE POLICY icm_delete_admin ON public.incident_cluster_members FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.incident_clusters c WHERE c.id = cluster_id AND has_role(auth.uid(), c.account_id, 'admin'::app_role)));
