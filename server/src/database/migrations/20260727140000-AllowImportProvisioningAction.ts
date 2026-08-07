import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `twilio_number_provisioning.action` is checked against
 * ('search','buy','release','configure') — the set that existed before
 * number *import* was a feature. Both the original edge function
 * (supabase/functions/twilio-numbers-import) and its NestJS port
 * (TwilioPhoneNumbersService.importExisting) log with action `'import'`,
 * so every import blew up on the audit insert with a 23514 — after the
 * Twilio webhooks had already been re-pointed and the phone_numbers row
 * written, i.e. the tenant transaction rolled back a change Twilio had
 * already accepted. Latent until now because no import had ever gotten
 * past the earlier PUBLIC_API_URL misconfiguration to reach this insert.
 */
export class AllowImportProvisioningAction20260727140000
  implements MigrationInterface
{
  name = 'AllowImportProvisioningAction20260727140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE public.twilio_number_provisioning
         DROP CONSTRAINT IF EXISTS twilio_number_provisioning_action_check;`,
    );
    await queryRunner.query(
      `ALTER TABLE public.twilio_number_provisioning
         ADD CONSTRAINT twilio_number_provisioning_action_check
         CHECK (action IN ('search','buy','import','release','configure'));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM public.twilio_number_provisioning WHERE action = 'import';`,
    );
    await queryRunner.query(
      `ALTER TABLE public.twilio_number_provisioning
         DROP CONSTRAINT IF EXISTS twilio_number_provisioning_action_check;`,
    );
    await queryRunner.query(
      `ALTER TABLE public.twilio_number_provisioning
         ADD CONSTRAINT twilio_number_provisioning_action_check
         CHECK (action IN ('search','buy','release','configure'));`,
    );
  }
}
