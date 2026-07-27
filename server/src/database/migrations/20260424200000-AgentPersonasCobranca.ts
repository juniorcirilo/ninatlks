import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424200000_agent_personas_cobranca.sql.
export class AgentPersonasCobranca20260424200000 implements MigrationInterface {
  name = 'AgentPersonasCobranca20260424200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- ============================================================
-- cobrAI · ajustes em agent_personas pra contexto de cobrança
-- ============================================================
-- source_user_id foi desenhado no Nexus pra "clonar estilo de um humano".
-- Em cobrança não faz sentido forçar — o agente é genérico da credora.
-- Relaxa pra nullable.

alter table public.agent_personas
  alter column source_user_id drop not null;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'AgentPersonasCobranca20260424200000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
