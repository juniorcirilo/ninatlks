import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260522174823_89400bba-4eeb-4b0d-830f-c755b106e1aa.sql.
export class Migration20260522174823 implements MigrationInterface {
  name = 'Migration20260522174823';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE OR REPLACE FUNCTION public.tg_contact_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' and new.stage_id is not null then
    new.stage_changed_at := now();
  elsif tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
  end if;
  return new;
end$function$;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260522174823 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
