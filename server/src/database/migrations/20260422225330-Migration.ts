import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260422225330_6c9e10c8-5b5b-40d2-89eb-95ceededdcb9.sql.
export class Migration20260422225330 implements MigrationInterface {
  name = 'Migration20260422225330';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.agent_personas
  add column if not exists elevenlabs_agent_id text,
  add column if not exists elevenlabs_knowledge_base_ids jsonb not null default '[]'::jsonb;
`);
    await queryRunner.query(`
comment on column public.agent_personas.elevenlabs_agent_id is
  'ElevenLabs Conversational AI agent ID. Null = not yet synced. Created by elevenlabs-agent-sync fn when persona is saved.';
`);
    await queryRunner.query(`
comment on column public.agent_personas.elevenlabs_knowledge_base_ids is
  'Array of EL knowledge base document IDs attached to this agent. Managed via /agents persona editor.';
`);
    await queryRunner.query(`
create index if not exists idx_personas_el_agent_id
  on public.agent_personas(elevenlabs_agent_id)
  where elevenlabs_agent_id is not null;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260422225330 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
