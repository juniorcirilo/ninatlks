
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- customer_memory_nodes
CREATE TABLE public.customer_memory_nodes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  kind varchar NOT NULL CHECK (kind IN ('fact','preference','trait','event','objection','win','entity')),
  summary text NOT NULL,
  content text,
  embedding vector(1536),
  confidence real NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  importance real NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cmn_embedding_hnsw ON public.customer_memory_nodes
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_cmn_account_contact_kind ON public.customer_memory_nodes (account_id, contact_id, kind);

ALTER TABLE public.customer_memory_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cmn_select_member" ON public.customer_memory_nodes
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cmn_insert_member" ON public.customer_memory_nodes
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));

CREATE POLICY "cmn_update_member" ON public.customer_memory_nodes
  FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cmn_delete_admin" ON public.customer_memory_nodes
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));

CREATE TRIGGER update_cmn_updated_at
  BEFORE UPDATE ON public.customer_memory_nodes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- customer_memory_edges
CREATE TABLE public.customer_memory_edges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  from_node_id bigint REFERENCES public.customer_memory_nodes(id) ON DELETE CASCADE,
  to_node_id bigint REFERENCES public.customer_memory_nodes(id) ON DELETE CASCADE,
  from_contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  to_contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  relation varchar NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cme_from_node ON public.customer_memory_edges (from_node_id);
CREATE INDEX idx_cme_to_node ON public.customer_memory_edges (to_node_id);

ALTER TABLE public.customer_memory_edges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cme_select_member" ON public.customer_memory_edges
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cme_insert_member" ON public.customer_memory_edges
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));

CREATE POLICY "cme_update_member" ON public.customer_memory_edges
  FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cme_delete_admin" ON public.customer_memory_edges
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));

-- contact_facts
CREATE TABLE public.contact_facts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  key varchar NOT NULL,
  value text,
  value_numeric real,
  confidence real NOT NULL DEFAULT 0.5,
  source_node_id bigint REFERENCES public.customer_memory_nodes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, key)
);

CREATE INDEX idx_cf_account_contact ON public.contact_facts (account_id, contact_id);

ALTER TABLE public.contact_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cf_select_member" ON public.contact_facts
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cf_insert_member" ON public.contact_facts
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));

CREATE POLICY "cf_update_member" ON public.contact_facts
  FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cf_delete_admin" ON public.contact_facts
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));

CREATE TRIGGER update_cf_updated_at
  BEFORE UPDATE ON public.contact_facts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- contact_dossiers
CREATE TABLE public.contact_dossiers (
  contact_id uuid PRIMARY KEY REFERENCES public.contacts(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  briefing text NOT NULL DEFAULT '',
  highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  embedding vector(1536),
  node_count integer NOT NULL DEFAULT 0,
  generated_at timestamptz NOT NULL DEFAULT now(),
  stale_after timestamptz NOT NULL DEFAULT (now() + interval '6 hours')
);

ALTER TABLE public.contact_dossiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cd_select_member" ON public.contact_dossiers
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cd_insert_member" ON public.contact_dossiers
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));

CREATE POLICY "cd_update_member" ON public.contact_dossiers
  FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "cd_delete_admin" ON public.contact_dossiers
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));

-- memory_extraction_state
CREATE TABLE public.memory_extraction_state (
  conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  last_extracted_message_id uuid,
  last_run_at timestamptz,
  status varchar NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','queued','running','failed')),
  error_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.memory_extraction_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mes_select_member" ON public.memory_extraction_state
  FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "mes_insert_member" ON public.memory_extraction_state
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));

CREATE POLICY "mes_update_member" ON public.memory_extraction_state
  FOR UPDATE TO authenticated
  USING (is_account_member(auth.uid(), account_id));

CREATE POLICY "mes_delete_admin" ON public.memory_extraction_state
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'));

CREATE TRIGGER update_mes_updated_at
  BEFORE UPDATE ON public.memory_extraction_state
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Enable realtime for memory nodes (useful for live updates in UI)
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_memory_nodes;
