import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424003000_null_lid_phone_numbers.sql.
export class NullLidPhoneNumbers20260424003000 implements MigrationInterface {
  name = 'NullLidPhoneNumbers20260424003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- WhatsApp LID privacy cleanup: null out phone_number on contacts whose
-- stored "phone" is actually a Baileys LID (15+ digits synthetic id),
-- never a real E.164 number. The evolution_remote_jid in custom_attributes
-- keeps the raw JID so outbound routing still works; UI stops showing
-- "118335039660213:46" as if it were a phone.
--
-- Criteria:
--   * identifier begins with "evolution:whatsapp:"
--   * phone_number has fewer than 11 or more than 14 characters (including
--     the leading "+"), i.e. digits outside the 10..13 real-phone range.

UPDATE public.contacts
SET phone_number = NULL
WHERE identifier LIKE 'evolution:whatsapp:%'
  AND phone_number IS NOT NULL
  AND (
    length(regexp_replace(phone_number, '\\D', '', 'g')) < 10
    OR length(regexp_replace(phone_number, '\\D', '', 'g')) > 13
  );
`);
    await queryRunner.query(`
-- Names that were "WhatsApp +139161923268721" now become "WhatsApp (sem
-- número)" so the list doesn't show a garbage pseudo-phone. Only touches
-- rows where name was auto-generated (starts with "WhatsApp +").
UPDATE public.contacts
SET name = 'WhatsApp (sem número)'
WHERE identifier LIKE 'evolution:whatsapp:%'
  AND phone_number IS NULL
  AND name ~ '^WhatsApp \\+\\d+$';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'NullLidPhoneNumbers20260424003000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
