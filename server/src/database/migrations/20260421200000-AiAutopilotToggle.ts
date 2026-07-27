import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260421200000_ai_autopilot_toggle.sql.
export class AiAutopilotToggle20260421200000 implements MigrationInterface {
  name = 'AiAutopilotToggle20260421200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Per-conversation AI autopilot toggle.
-- Default true so new conversations always start with the agent driving.
-- Operator flips to false via the ChatPanel "IA / Humano" toggle when they
-- want to take over manually; flipping back resumes auto-reply.
alter table public.conversations
  add column if not exists ai_autopilot_enabled boolean not null default true;
`);
    await queryRunner.query(`
comment on column public.conversations.ai_autopilot_enabled is
  'When false, persona-auto-reply skips this conversation. Toggled explicitly by the operator via the chat header — never auto-flipped on manual sends.';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'AiAutopilotToggle20260421200000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
