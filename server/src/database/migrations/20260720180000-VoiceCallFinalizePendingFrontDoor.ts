import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes the gap noted in 20260720150000's docblock: the post-call pipeline
 * (20260720170000) is fully wrapped, but `VoiceCallFinalizePendingProcessor`
 * itself — the thing that actually calls `CallFinalizeService.finalize()` /
 * `CallClassificationService.classify()` per row — still ran its own two
 * scan queries and its metadata-stamp UPDATE straight against `voice_calls`
 * via the plain `DataSource`. Under real RLS both scans return zero rows,
 * so `finalize()`/`classify()` are never invoked at all: the entire
 * already-wrapped pipeline from 20260720170000 is unreachable from the one
 * job that exists to drive it. Fixed here — the metadata-stamp step reuses
 * `voice_call_update_metadata` from 20260720170000, no new function needed
 * for it.
 */
export class VoiceCallFinalizePendingFrontDoor20260720180000
  implements MigrationInterface
{
  name = 'VoiceCallFinalizePendingFrontDoor20260720180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Mirrors the processor's `pending` query exactly.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_finalize_pending_scan(_cutoff timestamptz)
      RETURNS TABLE(id uuid)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vc.id FROM public.voice_calls vc
        WHERE vc.source_id IS NOT NULL
          AND (
            (vc.status IN ('queued','ringing','in_progress') AND vc.started_at < _cutoff)
            OR (vc.status = 'completed' AND vc.ended_at IS NULL)
            OR (vc.status = 'completed' AND vc.transcript IS NULL)
          )
        ORDER BY vc.started_at ASC NULLS LAST
        LIMIT 50;
      $$;
    `);

    // Mirrors the processor's `candidates` query exactly (LEFT JOIN chain
    // conversations -> contacts, same as the original raw SQL).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.voice_call_reclass_candidates_scan()
      RETURNS TABLE(id uuid, metadata jsonb, contact_id uuid, contact_name text)
      LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
        SELECT vc.id, vc.metadata, ct.id AS contact_id, ct.name AS contact_name
        FROM public.voice_calls vc
        LEFT JOIN public.conversations cv ON cv.id = vc.conversation_id
        LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
        WHERE vc.status = 'completed'
          AND vc.transcript IS NOT NULL
          AND vc.outcome_classified_at IS NOT NULL
        LIMIT 50;
      $$;
    `);

    const grants = [
      'voice_call_finalize_pending_scan(timestamptz)',
      'voice_call_reclass_candidates_scan()',
    ];
    for (const sig of grants) {
      await queryRunner.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
            GRANT EXECUTE ON FUNCTION public.${sig} TO ninatlks_app;
          END IF;
        END $$;
      `);
      await queryRunner.query(`REVOKE EXECUTE ON FUNCTION public.${sig} FROM PUBLIC;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.voice_call_reclass_candidates_scan();`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.voice_call_finalize_pending_scan(timestamptz);`);
  }
}
