import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416182055_919161f7-9f1f-47d5-a357-af8dff36e554.sql.
export class Migration20260416182055 implements MigrationInterface {
  name = 'Migration20260416182055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ──────────────────────────────────────────────────────────────────
-- PHONE NUMBERS
-- ──────────────────────────────────────────────────────────────────
CREATE TYPE public.phone_inbound_behavior AS ENUM (
  'ai_answer', 'suggest', 'forward_to_agent', 'voicemail'
);
`);
    await queryRunner.query(`
CREATE TYPE public.voice_call_direction AS ENUM ('inbound', 'outbound');
`);
    await queryRunner.query(`
CREATE TYPE public.voice_call_status AS ENUM (
  'queued', 'ringing', 'in_progress', 'completed', 'busy', 'failed', 'no_answer', 'canceled'
);
`);
    await queryRunner.query(`
CREATE TABLE public.phone_numbers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  e164          varchar(20) NOT NULL UNIQUE,
  friendly_name varchar(120),
  provider      varchar(32) NOT NULL DEFAULT 'twilio',
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  inbox_id      uuid REFERENCES public.inboxes(id) ON DELETE SET NULL,
  pinned_persona_id uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  inbound_behavior public.phone_inbound_behavior NOT NULL DEFAULT 'ai_answer',
  outbound_enabled boolean NOT NULL DEFAULT false,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_phone_numbers_account ON public.phone_numbers (account_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_phone_numbers_inbox ON public.phone_numbers (inbox_id);
`);
    await queryRunner.query(`
CREATE TRIGGER tg_phone_numbers_updated_at
  BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "phone_numbers_select_member" ON public.phone_numbers
  FOR SELECT USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "phone_numbers_insert_admin" ON public.phone_numbers
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
CREATE POLICY "phone_numbers_update_admin" ON public.phone_numbers
  FOR UPDATE USING (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
CREATE POLICY "phone_numbers_delete_admin" ON public.phone_numbers
  FOR DELETE USING (public.has_role(auth.uid(), account_id, 'admin'));
`);
    await queryRunner.query(`
-- ──────────────────────────────────────────────────────────────────
-- VOICE CALLS
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE public.voice_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  phone_number_id   uuid REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  persona_id        uuid REFERENCES public.agent_personas(id) ON DELETE SET NULL,
  handled_by_user_id uuid,
  direction         public.voice_call_direction NOT NULL,
  status            public.voice_call_status NOT NULL DEFAULT 'queued',
  provider          varchar(32) NOT NULL DEFAULT 'twilio',
  provider_call_sid varchar(64) UNIQUE,
  from_number       varchar(20) NOT NULL,
  to_number         varchar(20) NOT NULL,
  duration_seconds  integer NOT NULL DEFAULT 0,
  total_cost_cents  integer NOT NULL DEFAULT 0,
  recording_url     text,
  transcript        jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
`);
    await queryRunner.query(`
CREATE INDEX idx_voice_calls_account_started ON public.voice_calls (account_id, started_at DESC);
`);
    await queryRunner.query(`
CREATE INDEX idx_voice_calls_phone ON public.voice_calls (phone_number_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_voice_calls_conversation ON public.voice_calls (conversation_id);
`);
    await queryRunner.query(`
CREATE INDEX idx_voice_calls_status ON public.voice_calls (status);
`);
    await queryRunner.query(`
CREATE TRIGGER tg_voice_calls_updated_at
  BEFORE UPDATE ON public.voice_calls
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
`);
    await queryRunner.query(`
ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;
`);
    await queryRunner.query(`
CREATE POLICY "voice_calls_select_member" ON public.voice_calls
  FOR SELECT USING (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "voice_calls_insert_member" ON public.voice_calls
  FOR INSERT WITH CHECK (public.is_account_member(auth.uid(), account_id));
`);
    await queryRunner.query(`
CREATE POLICY "voice_calls_update_member" ON public.voice_calls
  FOR UPDATE USING (public.is_account_member(auth.uid(), account_id));
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416182055 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
