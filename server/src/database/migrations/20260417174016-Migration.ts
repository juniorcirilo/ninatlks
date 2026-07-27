import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260417174016_8f36606f-20b9-49a4-8bfb-0e3671e62f59.sql.
export class Migration20260417174016 implements MigrationInterface {
  name = 'Migration20260417174016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'channel_type' and e.enumlabel = 'messenger'
  ) then
    alter type public.channel_type add value 'messenger';
  end if;
end $$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260417174016 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
