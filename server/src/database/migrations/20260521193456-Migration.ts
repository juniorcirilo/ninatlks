import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260521193456_9ed0bf89-ae0d-4b07-9beb-735d08b735e6.sql.
export class Migration20260521193456 implements MigrationInterface {
  name = 'Migration20260521193456';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- 1) Update contact last_call_at + last_activity_at when a voice call ends
CREATE OR REPLACE FUNCTION public.tg_voice_call_update_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
  v_when timestamptz;
  v_new_op text;
BEGIN
  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT contact_id INTO v_contact_id FROM public.conversations WHERE id = NEW.conversation_id;
  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_when := COALESCE(NEW.ended_at, NEW.started_at, now());

  -- Map outcome to operational_status (only if outcome just got set/changed)
  IF NEW.outcome_category IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.outcome_category IS DISTINCT FROM NEW.outcome_category) THEN
    v_new_op := CASE lower(NEW.outcome_category)
      WHEN 'won' THEN 'closed_won'
      WHEN 'sale' THEN 'closed_won'
      WHEN 'closed_won' THEN 'closed_won'
      WHEN 'lost' THEN 'closed_lost'
      WHEN 'closed_lost' THEN 'closed_lost'
      WHEN 'no_answer' THEN 'no_response'
      WHEN 'voicemail' THEN 'no_response'
      WHEN 'callback' THEN 'qualifying'
      WHEN 'follow_up' THEN 'qualifying'
      WHEN 'interested' THEN 'qualifying'
      WHEN 'not_interested' THEN 'closed_lost'
      WHEN 'do_not_call' THEN 'do_not_contact'
      ELSE NULL
    END;
  END IF;

  UPDATE public.contacts
     SET last_call_at = GREATEST(COALESCE(last_call_at, 'epoch'::timestamptz), v_when),
         last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), v_when),
         operational_status = COALESCE(v_new_op::public.operational_status, operational_status)
   WHERE id = v_contact_id;

  RETURN NEW;
END;
$$;
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_voice_call_update_contact ON public.voice_calls;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_voice_call_update_contact
AFTER INSERT OR UPDATE OF ended_at, outcome_category ON public.voice_calls
FOR EACH ROW EXECUTE FUNCTION public.tg_voice_call_update_contact();
`);
    await queryRunner.query(`
-- 2) Update contact last_whatsapp_at + last_activity_at on whatsapp messages
CREATE OR REPLACE FUNCTION public.tg_message_update_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
  v_channel_type text;
BEGIN
  IF NEW.private = true THEN
    RETURN NEW;
  END IF;

  SELECT c.contact_id, ch.channel_type
    INTO v_contact_id, v_channel_type
  FROM public.conversations c
  LEFT JOIN public.inboxes i ON i.id = c.inbox_id
  LEFT JOIN public.channels ch ON ch.id = i.channel_id
  WHERE c.id = NEW.conversation_id;

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_channel_type IN ('whatsapp','whatsapp_cloud','uazapi','evolution') THEN
    UPDATE public.contacts
       SET last_whatsapp_at = GREATEST(COALESCE(last_whatsapp_at, 'epoch'::timestamptz), NEW.created_at),
           last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), NEW.created_at)
     WHERE id = v_contact_id;
  ELSE
    UPDATE public.contacts
       SET last_activity_at = GREATEST(COALESCE(last_activity_at, 'epoch'::timestamptz), NEW.created_at)
     WHERE id = v_contact_id;
  END IF;

  RETURN NEW;
END;
$$;
`);
    await queryRunner.query(`
DROP TRIGGER IF EXISTS trg_message_update_contact ON public.messages;
`);
    await queryRunner.query(`
CREATE TRIGGER trg_message_update_contact
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.tg_message_update_contact();
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260521193456 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
