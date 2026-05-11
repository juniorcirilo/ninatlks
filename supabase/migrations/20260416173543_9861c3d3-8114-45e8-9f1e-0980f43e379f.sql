
-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text,
  email text,
  phone_number text,
  identifier text,
  additional_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  location text,
  country_code varchar(10),
  blocked boolean NOT NULL DEFAULT false,
  company_id uuid,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, email)
);

CREATE INDEX idx_contacts_account ON public.contacts(account_id);
CREATE INDEX idx_contacts_phone_account ON public.contacts(phone_number, account_id);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select_member" ON public.contacts
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "contacts_insert_member" ON public.contacts
  FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY "contacts_update_member" ON public.contacts
  FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "contacts_delete_admin" ON public.contacts
  FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER set_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- CONTACT_INBOXES
-- ============================================================
CREATE TABLE public.contact_inboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES public.inboxes(id) ON DELETE CASCADE,
  source_id text,
  hmac_verified boolean NOT NULL DEFAULT false,
  pubsub_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(inbox_id, source_id)
);

ALTER TABLE public.contact_inboxes ENABLE ROW LEVEL SECURITY;

-- RLS via contact's account
CREATE POLICY "contact_inboxes_select" ON public.contact_inboxes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND is_account_member(auth.uid(), c.account_id)
  ));
CREATE POLICY "contact_inboxes_insert" ON public.contact_inboxes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND is_account_member(auth.uid(), c.account_id)
  ));
CREATE POLICY "contact_inboxes_update" ON public.contact_inboxes
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = contact_id AND is_account_member(auth.uid(), c.account_id)
  ));

CREATE TRIGGER set_contact_inboxes_updated_at
  BEFORE UPDATE ON public.contact_inboxes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- EXPAND INBOXES
-- ============================================================
ALTER TABLE public.inboxes
  ADD COLUMN IF NOT EXISTS channel_type text,
  ADD COLUMN IF NOT EXISTS enable_auto_assignment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS greeting_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS working_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS out_of_office_message text,
  ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS csat_survey_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_messages_after_resolved boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_assignment_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS portal_id uuid,
  ADD COLUMN IF NOT EXISTS csat_config jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES public.inboxes(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  status smallint NOT NULL DEFAULT 0,
  assignee_id uuid,
  display_id integer NOT NULL DEFAULT 0,
  contact_last_seen_at timestamptz,
  agent_last_seen_at timestamptz,
  additional_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  uuid text DEFAULT gen_random_uuid()::text,
  identifier text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  team_id uuid,
  campaign_id uuid,
  snoozed_until timestamptz,
  custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_reply_created_at timestamptz,
  priority smallint DEFAULT 0,
  sla_policy_id uuid,
  waiting_since timestamptz,
  cached_label_list text,
  assignee_agent_bot_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, display_id)
);

CREATE INDEX idx_conversations_account_status ON public.conversations(account_id, status);
CREATE INDEX idx_conversations_inbox ON public.conversations(inbox_id);
CREATE INDEX idx_conversations_contact ON public.conversations(contact_id);
CREATE INDEX idx_conversations_assignee ON public.conversations(assignee_id);
CREATE INDEX idx_conversations_last_activity ON public.conversations(last_activity_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select_member" ON public.conversations
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "conversations_insert_member" ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY "conversations_update_member" ON public.conversations
  FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "conversations_delete_admin" ON public.conversations
  FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER set_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Function to auto-generate display_id
CREATE OR REPLACE FUNCTION public.tg_set_conversation_display_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  SELECT COALESCE(MAX(display_id), 0) + 1
  INTO NEW.display_id
  FROM public.conversations
  WHERE account_id = NEW.account_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_conversation_display_id
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_conversation_display_id();

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  inbox_id uuid NOT NULL REFERENCES public.inboxes(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_type smallint NOT NULL DEFAULT 0,
  private boolean NOT NULL DEFAULT false,
  source_id text,
  content_type smallint NOT NULL DEFAULT 0,
  content_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  sender_type text,
  sender_id uuid,
  external_source_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  additional_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_message_content text,
  sentiment jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_account ON public.messages(account_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select_member" ON public.messages
  FOR SELECT TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "messages_insert_member" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (is_account_member(auth.uid(), account_id));
CREATE POLICY "messages_update_member" ON public.messages
  FOR UPDATE TO authenticated USING (is_account_member(auth.uid(), account_id));
CREATE POLICY "messages_delete_admin" ON public.messages
  FOR DELETE TO authenticated USING (has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER set_messages_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Enable realtime for messages and conversations
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
