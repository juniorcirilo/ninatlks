import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421220000_telegram_channel.sql.
export class TelegramChannel20260421220000 implements MigrationInterface {
  name = 'TelegramChannel20260421220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Telegram channel, unified via Zernio (same webhook + outbound path as IG/FB).
-- Guarded add-enum-value so re-running is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
     where pg_type.typname = 'channel_type' and pg_enum.enumlabel = 'telegram'
  ) then
    alter type public.channel_type add value 'telegram';
  end if;
end $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'TelegramChannel20260421220000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
