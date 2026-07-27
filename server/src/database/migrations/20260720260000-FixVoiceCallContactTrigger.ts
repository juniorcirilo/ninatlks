import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `tg_voice_call_update_contact()` (the trigger that updates
 * `contacts.last_call_at`/`operational_status` whenever a `voice_calls` row
 * with a `conversation_id` is inserted/updated) casts to
 * `public.operational_status` — a type that has never existed in this
 * schema. The real enum is `contact_operational_status`
 * (`contacts.operational_status`'s actual column type). Postgres resolves
 * cast target types at parse time regardless of the value being cast, so
 * this fails with "type public.operational_status does not exist" on
 * EVERY insert/update of a `voice_calls` row that has `conversation_id`
 * set — not a silent no-op, a hard error — found while seeding test data
 * to verify the SECURITY DEFINER fixes in this same migration batch
 * (20260720180000 onward). Same class of pre-existing schema drift as the
 * bugs already catalogued in docs/SUPABASE_CUTOVER.md §1 (merge_contacts,
 * channels/inboxes join, etc.) — not introduced by this migration pass.
 */
export class FixVoiceCallContactTrigger20260720260000
  implements MigrationInterface
{
  name = 'FixVoiceCallContactTrigger20260720260000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.tg_voice_call_update_contact()
      RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
               operational_status = COALESCE(v_new_op::public.contact_operational_status, operational_status)
         WHERE id = v_contact_id;

        RETURN NEW;
      END;
      $function$;
    `);
  }

  public async down(): Promise<void> {
    // Intentionally not reverted: restoring the broken cast would
    // reintroduce a hard-failing trigger on every voice_calls write with a
    // conversation_id set. No down migration for a bug fix like this.
  }
}
