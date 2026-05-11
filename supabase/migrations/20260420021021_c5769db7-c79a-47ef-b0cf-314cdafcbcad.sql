-- ===== voice_campaigns =====
CREATE TABLE IF NOT EXISTS public.voice_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','failed','cancelled')),
  mode text NOT NULL DEFAULT 'script_readback' CHECK (mode IN ('script_readback','conversational')),
  persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  voice_id text,
  from_number text NOT NULL,
  opening_script text,
  escalation_target_number text,
  escalation_keywords jsonb NOT NULL DEFAULT '["atendente","humano","gerente","supervisor","operador","representante"]'::jsonb,
  record_call boolean NOT NULL DEFAULT false,
  max_concurrent integer NOT NULL DEFAULT 5,
  retry_attempts integer NOT NULL DEFAULT 1,
  retry_delay_minutes integer NOT NULL DEFAULT 30,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  total_contacts integer NOT NULL DEFAULT 0,
  placed_count integer NOT NULL DEFAULT 0,
  connected_count integer NOT NULL DEFAULT 0,
  escalated_count integer NOT NULL DEFAULT 0,
  voicemail_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_campaigns_account_status ON public.voice_campaigns(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_campaigns_scheduled ON public.voice_campaigns(status, scheduled_at) WHERE status IN ('scheduled','running');

ALTER TABLE public.voice_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view voice campaigns"
  ON public.voice_campaigns FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));

CREATE POLICY "admins can insert voice campaigns"
  ON public.voice_campaigns FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE POLICY "admins can update voice campaigns"
  ON public.voice_campaigns FOR UPDATE
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE POLICY "admins can delete voice campaigns"
  ON public.voice_campaigns FOR DELETE
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER trg_voice_campaigns_updated_at
  BEFORE UPDATE ON public.voice_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ===== voice_campaign_contacts =====
CREATE TABLE IF NOT EXISTS public.voice_campaign_contacts (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.voice_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  to_number text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','placed','connected','completed','escalated','voicemail','failed','no_answer','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  provider_call_sid text,
  voice_call_id bigint,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vcc_campaign_status ON public.voice_campaign_contacts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_vcc_dispatch_queue ON public.voice_campaign_contacts(status, next_retry_at) WHERE status IN ('queued');
CREATE INDEX IF NOT EXISTS idx_vcc_account ON public.voice_campaign_contacts(account_id, created_at DESC);

ALTER TABLE public.voice_campaign_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view campaign contacts"
  ON public.voice_campaign_contacts FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));

CREATE POLICY "admins can manage campaign contacts"
  ON public.voice_campaign_contacts FOR ALL
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER trg_vcc_updated_at
  BEFORE UPDATE ON public.voice_campaign_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ===== escalation_rules =====
CREATE TABLE IF NOT EXISTS public.escalation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  action text NOT NULL DEFAULT 'transfer' CHECK (action IN ('transfer','voicemail','hangup')),
  target_number text,
  voicemail_message text,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_rules_account ON public.escalation_rules(account_id, enabled, priority);

ALTER TABLE public.escalation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view escalation rules"
  ON public.escalation_rules FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));

CREATE POLICY "admins can manage escalation rules"
  ON public.escalation_rules FOR ALL
  USING (public.has_role(auth.uid(), account_id, 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'::app_role));

CREATE TRIGGER trg_escalation_rules_updated_at
  BEFORE UPDATE ON public.escalation_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ===== elevenlabs_usage_log =====
CREATE TABLE IF NOT EXISTS public.elevenlabs_usage_log (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  voice_id text,
  model_id text,
  character_count integer NOT NULL DEFAULT 0,
  purpose text NOT NULL DEFAULT 'preview' CHECK (purpose IN ('preview','campaign','runtime','clone','test')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eleven_usage_account_date ON public.elevenlabs_usage_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eleven_usage_purpose ON public.elevenlabs_usage_log(account_id, purpose, created_at DESC);

ALTER TABLE public.elevenlabs_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view eleven usage"
  ON public.elevenlabs_usage_log FOR SELECT
  USING (public.is_account_member(auth.uid(), account_id));

-- inserts via service_role only (no user-level INSERT policy needed)

-- ===== RPC bump_voice_campaign_totals =====
CREATE OR REPLACE FUNCTION public.bump_voice_campaign_totals(
  p_campaign_id uuid,
  p_placed integer DEFAULT 0,
  p_connected integer DEFAULT 0,
  p_escalated integer DEFAULT 0,
  p_voicemail integer DEFAULT 0,
  p_failed integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.voice_campaigns
     SET placed_count    = placed_count    + COALESCE(p_placed, 0),
         connected_count = connected_count + COALESCE(p_connected, 0),
         escalated_count = escalated_count + COALESCE(p_escalated, 0),
         voicemail_count = voicemail_count + COALESCE(p_voicemail, 0),
         failed_count    = failed_count    + COALESCE(p_failed, 0),
         updated_at      = now()
   WHERE id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bump_voice_campaign_totals(uuid, integer, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_voice_campaign_totals(uuid, integer, integer, integer, integer, integer) TO authenticated, service_role;

-- ===== Realtime publication =====
ALTER TABLE public.voice_campaigns REPLICA IDENTITY FULL;
ALTER TABLE public.voice_campaign_contacts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_campaigns'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_campaigns;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'voice_campaign_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.voice_campaign_contacts;
  END IF;
END $$;