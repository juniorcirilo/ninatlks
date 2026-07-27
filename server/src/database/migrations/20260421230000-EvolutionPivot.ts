import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421230000_evolution_pivot.sql.
export class EvolutionPivot20260421230000 implements MigrationInterface {
  name = 'EvolutionPivot20260421230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- WhatsApp pivot: Meta Cloud API → Evolution API (Baileys).
--
-- Changes:
--   1. Unschedule the templates-sync cron — the edge function is gone.
--   2. Leave whatsapp_templates table in place (historical data / reference)
--      but new channels won't populate it.
--   3. channels.config semantics for whatsapp channels flip from
--      { phone_number_id, access_token, waba_id } → { evolution_url,
--      evolution_api_key, evolution_instance_name, ... }. No schema change
--      since config is jsonb.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname in ('nexus-templates-sync');
  end if;
exception when others then
  raise notice 'cron unschedule skipped: %', SQLERRM;
end $$;
`);
    await queryRunner.query(`
comment on table public.whatsapp_templates is
  'Legacy Meta Cloud API templates. No longer written to; Evolution (Baileys) has no template concept. Kept for historical reference.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'EvolutionPivot20260421230000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
