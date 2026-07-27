import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260423100000_elevenlabs_phone.sql.
export class ElevenlabsPhone20260423100000 implements MigrationInterface {
  name = 'ElevenlabsPhone20260423100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Mirror ElevenLabs phone_number_id on our phone_numbers table.
-- Flow: /phone-numbers import → register at EL → EL reconfigures the
-- Twilio Voice webhook to their endpoint → we store the EL phone id so
-- outbound calls can use POST /v1/convai/twilio/outbound-call.
alter table public.phone_numbers
  add column if not exists elevenlabs_phone_number_id text;
`);
    await queryRunner.query(`
comment on column public.phone_numbers.elevenlabs_phone_number_id is
  'ElevenLabs convai phone number id (phnum_…). When set, inbound calls hit api.elevenlabs.io/twilio/inbound_call instead of our twilio-incoming; outbound can use POST /v1/convai/twilio/outbound-call with this id.';
`);
    await queryRunner.query(`
create index if not exists idx_phone_numbers_el_phone
  on public.phone_numbers(elevenlabs_phone_number_id)
  where elevenlabs_phone_number_id is not null;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'ElevenlabsPhone20260423100000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
