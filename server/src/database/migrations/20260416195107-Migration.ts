import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416195107_7db1ad67-77b9-4601-9735-818362445661.sql.
export class Migration20260416195107 implements MigrationInterface {
  name = 'Migration20260416195107';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- =======================================
-- 1. CAMPAIGN RUNS (histórico de campanhas)
-- =======================================
CREATE TABLE public.campaign_runs (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  inbox_id UUID NOT NULL REFERENCES public.inboxes(id) ON DELETE CASCADE,
  persona_id UUID NOT NULL REFERENCES public.agent_personas(id) ON DELETE CASCADE,
  triggered_by_id UUID,
  message_template TEXT,
  used_ai BOOLEAN NOT NULL DEFAULT false,
  contact_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
`);
    await queryRunner.query(`
CREATE INDEX idx_campaign_runs_account_created ON public.campaign_runs(account_id, created_at DESC);
`);
    await queryRunner.query(`
ALTER TABLE public.campaign_runs ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY cr_select_member ON public.campaign_runs FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY cr_insert_member ON public.campaign_runs FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY cr_delete_admin ON public.campaign_runs FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- =======================================
-- 2. WEBHOOK DELIVERIES (log de entregas)
-- =======================================
CREATE TABLE public.webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  endpoint VARCHAR(120) NOT NULL,
  direction VARCHAR(10) NOT NULL DEFAULT 'inbound',
  http_status INTEGER,
  duration_ms INTEGER,
  source_ip TEXT,
  signature_valid BOOLEAN,
  payload_preview TEXT,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_webhook_deliveries_account_created ON public.webhook_deliveries(account_id, created_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_webhook_deliveries_endpoint ON public.webhook_deliveries(account_id, endpoint, created_at DESC);
`);
    await queryRunner.query(`
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY wd_select_member ON public.webhook_deliveries FOR SELECT TO authenticated
  USING (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY wd_delete_admin ON public.webhook_deliveries FOR DELETE TO authenticated
  USING (has_role(auth.uid(), account_id, 'admin'::app_role));
`);
    await queryRunner.query(`
-- Inserts only via service role (edge functions)

-- =======================================
-- 3. NOTIFICATIONS (caixa por usuário)
-- =======================================
CREATE TABLE public.notifications (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  kind VARCHAR(40) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_to TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id) WHERE read_at IS NULL;
`);
    await queryRunner.query(`
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY notif_select_self ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
`);
    await queryRunner.query(`
CREATE POLICY notif_update_self ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
`);
    await queryRunner.query(`
CREATE POLICY notif_insert_member ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY notif_delete_self ON public.notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());
`);
    await queryRunner.query(`
-- =======================================
-- 4. REALTIME para messages (para reactions)
-- =======================================
ALTER TABLE public.messages REPLICA IDENTITY FULL;
`);
    await queryRunner.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
`);
    await queryRunner.query(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416195107 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
