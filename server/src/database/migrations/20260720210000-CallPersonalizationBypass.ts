import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `CallPersonalizationService` (ported from
 * supabase/functions/elevenlabs-personalization) is the ElevenLabs webhook
 * that injects live context (persona, contact, dossier, upcoming meeting,
 * company settings) at the start of every call. It only has one call site —
 * the unauthenticated `@Public()` personalization webhook — so there is no
 * "safe path" at all today: every raw query against `agent_personas`/
 * `contacts`/`conversations`/`contact_dossiers`/`company_settings`/
 * `scheduled_meetings` via the plain DataSource silently returns zero rows
 * under real RLS. Practical effect: every EL call's persona/context
 * injection silently degrades to hardcoded defaults ("Nina", no contact
 * name, no history, no meeting context) with no error surfaced anywhere.
 *
 * The 4 original queries (persona-by-agent, contact-by-phone, open-convo
 * count, dossier briefing, company settings, next meeting, contact score)
 * are consolidated into fewer, purpose-built functions rather than a 1:1
 * port — `personalization_get_contact_context` does the contact lookup +
 * open-conversation count + dossier briefing + score in one call, since
 * `personalize()` always needs all four together once it has a contact.
 */
export class CallPersonalizationBypass20260720210000
  implements MigrationInterface
{
  name = 'CallPersonalizationBypass20260720210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.personalization_get_persona_by_el_agent(_el_agent_id text)
      RETURNS TABLE(account_id uuid, name text, system_prompt text, first_message text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT p.account_id, p.name, p.system_prompt, p.first_message
        FROM public.agent_personas p WHERE p.elevenlabs_agent_id = _el_agent_id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.personalization_get_contact_context(_account_id uuid, _phone text)
      RETURNS TABLE(id uuid, name text, score int, open_conversations bigint, dossier_briefing text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT
          c.id, c.name, c.score,
          (SELECT count(*) FROM public.conversations conv
             WHERE conv.account_id = _account_id AND conv.contact_id = c.id AND conv.status = 0) AS open_conversations,
          (SELECT d.briefing FROM public.contact_dossiers d WHERE d.contact_id = c.id LIMIT 1) AS dossier_briefing
        FROM public.contacts c
        WHERE c.account_id = _account_id AND c.phone_number = _phone
        LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.personalization_get_company_settings(_account_id uuid)
      RETURNS TABLE(company_name text, support_phone text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT cs.company_name, cs.support_phone FROM public.company_settings cs
        WHERE cs.account_id = _account_id LIMIT 1;
      $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.personalization_get_next_meeting(_account_id uuid, _contact_id uuid)
      RETURNS TABLE(id uuid, starts_at timestamptz)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT m.id, m.starts_at FROM public.scheduled_meetings m
        WHERE m.account_id = _account_id AND m.contact_id = _contact_id
          AND m.status = 'scheduled' AND m.starts_at > now()
        ORDER BY m.starts_at ASC LIMIT 1;
      $$;
    `);

    const grants = [
      'personalization_get_persona_by_el_agent(text)',
      'personalization_get_contact_context(uuid, text)',
      'personalization_get_company_settings(uuid)',
      'personalization_get_next_meeting(uuid, uuid)',
    ];
    for (const sig of grants) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
            GRANT EXECUTE ON FUNCTION public.${sig} TO ninatlks_app;
          END IF;
        END $$;
      `);
      await queryRunner.query(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fns = [
      'personalization_get_next_meeting(uuid, uuid)',
      'personalization_get_company_settings(uuid)',
      'personalization_get_contact_context(uuid, text)',
      'personalization_get_persona_by_el_agent(text)',
    ];
    for (const sig of fns) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
  }
}
