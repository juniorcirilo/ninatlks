import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424003910_a5f7da19-9d2c-4320-a0c0-c4da7da5fe52.sql.
export class Migration20260424003910 implements MigrationInterface {
  name = 'Migration20260424003910';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Limpa phone_numbers gerados a partir de JIDs @lid (não são telefones reais).
-- Filtra por identifier LIKE 'evolution:whatsapp:%' pra não tocar contatos
-- de outros canais (Instagram, Telegram, SMS, etc.).
UPDATE contacts
SET phone_number = NULL,
    updated_at = now()
WHERE identifier LIKE 'evolution:whatsapp:%'
  AND (
    custom_attributes->>'evolution_remote_jid' LIKE '%@lid'
    OR custom_attributes->>'evolution_lid_only' = 'true'
    OR (phone_number IS NOT NULL AND length(regexp_replace(phone_number, '\\D', '', 'g')) > 13)
  );
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260424003910 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
