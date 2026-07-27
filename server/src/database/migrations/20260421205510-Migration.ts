import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421205510_5ec0b75d-9434-4fde-8b31-481a7552c817.sql.
export class Migration20260421205510 implements MigrationInterface {
  name = 'Migration20260421205510';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
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
      'Migration20260421205510 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
