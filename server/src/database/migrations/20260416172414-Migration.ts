import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260416172414_ff5f74a9-0387-4570-abde-e91f9d432b48.sql.
export class Migration20260416172414 implements MigrationInterface {
  name = 'Migration20260416172414';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260416172414 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
