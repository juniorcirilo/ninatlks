import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260426181025_a5ce2ca2-9c13-4287-9d9f-5e3d59bcce79.sql.
export class Migration20260426181025 implements MigrationInterface {
  name = 'Migration20260426181025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Realinha a CHECK constraint de current_step com o wizard atual.
-- Sem isso, qualquer upsert com current_step in
-- ('empresa','elevenlabs','twilio','deepgram','evolution','agente','numero')
-- falha com 23514 e o admin fica preso.

ALTER TABLE public.org_onboarding_state
  DROP CONSTRAINT IF EXISTS org_onboarding_state_current_step_check;
`);
    await queryRunner.query(`
ALTER TABLE public.org_onboarding_state
  ADD CONSTRAINT org_onboarding_state_current_step_check
  CHECK (current_step IN (
    'welcome',
    'empresa',
    'elevenlabs',
    'twilio',
    'deepgram',
    'evolution',
    'agente',
    'numero',
    'done',
    -- Legacy steps mantidos para back-compat com rows antigos
    'org', 'inbox', 'keys', 'invite', 'persona',
    'objetivos', 'whatsapp', 'instagram_messenger',
    'crm', 'agenda_billing', 'regras_ligacao'
  ));
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260426181025 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
