import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260419130000_sprint4_realtime.sql.
export class Sprint4Realtime20260419130000 implements MigrationInterface {
  name = 'Sprint4Realtime20260419130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- Sprint 4 — Realtime publications so UI updates without F5
-- ============================================================
-- Supabase realtime is driven by the supabase_realtime publication. Tables
-- already in the publication are known to be: messages, conversations,
-- customer_memory_nodes, live_sessions, live_takeovers, conversation_replays,
-- notifications. Missing pieces the UI wants:
--   - campaign_runs: user wants to see progress while a campaign dispatches
--   - whatsapp_templates: user wants to know when Meta approves/rejects
--   - voice_calls: inbound call pops into /phone-numbers immediately
--   - conversation_signals: incidents UI reacts to new signals

do $$
begin
  -- campaign_runs
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'campaign_runs'
  ) then
    execute 'alter publication supabase_realtime add table public.campaign_runs';
  end if;

  -- whatsapp_templates
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_templates'
  ) then
    execute 'alter publication supabase_realtime add table public.whatsapp_templates';
  end if;

  -- voice_calls
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_calls'
  ) then
    execute 'alter publication supabase_realtime add table public.voice_calls';
  end if;

  -- conversation_signals
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_signals'
  ) then
    execute 'alter publication supabase_realtime add table public.conversation_signals';
  end if;
end $$;
`);
    await queryRunner.query(`
-- Realtime requires REPLICA IDENTITY FULL for updates to be usable. Safe
-- to apply even if it was already set.
alter table public.campaign_runs replica identity full;
`);
    await queryRunner.query(`
alter table public.whatsapp_templates replica identity full;
`);
    await queryRunner.query(`
alter table public.voice_calls replica identity full;
`);
    await queryRunner.query(`
alter table public.conversation_signals replica identity full;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Sprint4Realtime20260419130000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
