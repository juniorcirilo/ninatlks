import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `conversation_outcomes.source` is `varchar(20)`, but at least two real
 * write paths use longer literal provenance tags: `'lead-classify-from-call'`
 * (24 chars, call-classification.service.ts) and
 * `'agent-tool-qualify-lead'` (24 chars, agent-tools.service.ts) — both
 * inherited verbatim from the original edge function names. Every call to
 * either path fails with "value too long for type character varying(20)".
 * Found while verifying the 20260720180000 front-door fix actually lets
 * `CallClassificationService.classify()` run for real (previously
 * unreachable under RLS, so this was never exercised end-to-end before).
 * `outcome_type` on the same table is already `varchar(40)` — matching
 * that width here rather than inventing a new one.
 */
export class WidenConversationOutcomesSource20260720270000
  implements MigrationInterface
{
  name = 'WidenConversationOutcomesSource20260720270000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE public.conversation_outcomes ALTER COLUMN source TYPE varchar(40);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE public.conversation_outcomes ALTER COLUMN source TYPE varchar(20);`,
    );
  }
}
