import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260424010000_confidence_threshold_default_04.sql.
export class ConfidenceThresholdDefault0420260424010000 implements MigrationInterface {
  name = 'ConfidenceThresholdDefault0420260424010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
-- Lower default confidence_threshold from 0.7 → 0.4.
--
-- Why: saudações curtas ("Oi", "Teste", "Tudo bem?") geram reply curta que
-- raramente passa de 0.6 na heurística do persona-auto-reply. Com 0.7 a
-- IA caía silenciosamente em "low_confidence" e o operador ficava sem
-- saber. 0.4 é a faixa que a migration 20260421210000_persona_autoreply_relax
-- já usa como fallback quando não há deployment explícito; unificar o
-- default aqui elimina a divergência.
--
-- Impacto: deployments existentes com 0.7 são bumped para 0.4 (mesmo
-- critério que a migration de relax já aplicou — esta é reaplicação
-- idempotente pra alcançar rows criadas depois daquela migration).
-- Thresholds customizados (qualquer valor diferente de 0.7) ficam
-- intactos.

ALTER TABLE public.agent_persona_deployments
  ALTER COLUMN confidence_threshold SET DEFAULT 0.4;
`);
    await queryRunner.query(`
UPDATE public.agent_persona_deployments
SET confidence_threshold = 0.4
WHERE confidence_threshold = 0.7;
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'ConfidenceThresholdDefault0420260424010000 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
