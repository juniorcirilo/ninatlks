import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Found by grepping for `dataSource.query` outside common/database and
 * comparing against the pattern the codebase already uses consistently for
 * OTHER cross-account job reads (`cadence_due`/`cadence_advance`,
 * `meeting_reminder_due`/`meeting_noshow_due` — all SECURITY DEFINER SQL
 * functions, since jobs have no request/session to scope a `TenantTxHost`
 * transaction to, and legitimately need to see every account's due work in
 * one tick). `RateLimitAlertProcessor` didn't follow that pattern — it hit
 * `channel_usage_metrics`/`user_roles`/`notifications` directly via the
 * app's RLS-enforced role, so under real RLS it always saw zero rows
 * (silently: no alerts ever fire). Fixed here — this processor is fully
 * self-contained (no downstream service calls), so wrapping its 4 raw
 * queries in one SECURITY DEFINER function is a complete fix.
 *
 * NOT fixed here, found to have the same gap but explicitly out of scope
 * for a quick pass (see docs/SUPABASE_CUTOVER.md):
 * - `VoiceCallFinalizePendingProcessor` — its own 2 raw queries could be
 *   wrapped the same way, but it then calls `CallFinalizeService.finalize()`
 *   / `CallClassificationService.classify()` per row, and those (and the
 *   rest of the voice module — sentiment, summary, transcription) have the
 *   identical raw-`voice_calls`-access gap internally. Wrapping only the
 *   processor's own queries would look fixed while the real per-call work
 *   still silently no-ops. Voice is the plan's own highest-risk domain
 *   (live call state) — needs a deliberate pass, not a drive-by fix.
 * - `MediaCleanupProcessor` — parameterized by table/column across several
 *   unrelated tables; a generic dynamic-SQL SECURITY DEFINER function needs
 *   identifier allowlisting, more care than this migration's pattern.
 */
export class JobsCrossAccountBypass20260720150000
  implements MigrationInterface
{
  name = 'JobsCrossAccountBypass20260720150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION public.rate_limit_alert_tick(_threshold_pct numeric)
      RETURNS TABLE(account_id uuid, product_kind text, peak_pct numeric)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        r RECORD;
        v_admin uuid;
        v_existing int;
      BEGIN
        FOR r IN
          SELECT DISTINCT ON (m.account_id, m.product_kind)
            m.account_id, m.product_kind,
            GREATEST(coalesce(m.total_time_pct, 0), coalesce(m.total_cputime_pct, 0), coalesce(m.call_volume_pct, 0)) AS peak
          FROM public.channel_usage_metrics m
          WHERE m.bucket_hour >= now() - interval '1 hour'
            AND (m.total_time_pct >= _threshold_pct OR m.total_cputime_pct >= _threshold_pct OR m.call_volume_pct >= _threshold_pct)
          ORDER BY m.account_id, m.product_kind, peak DESC
        LOOP
          SELECT user_id INTO v_admin FROM public.user_roles
            WHERE user_roles.account_id = r.account_id AND role = 'admin' LIMIT 1;
          IF v_admin IS NULL THEN CONTINUE; END IF;

          SELECT count(*) INTO v_existing FROM public.notifications n
            WHERE n.account_id = r.account_id AND n.user_id = v_admin AND n.kind = 'rate_limit_alert'
              AND n.created_at >= now() - interval '1 hour';
          IF v_existing > 0 THEN CONTINUE; END IF;

          INSERT INTO public.notifications (account_id, user_id, kind, title, body, link_to, metadata)
          VALUES (
            r.account_id, v_admin, 'rate_limit_alert',
            'Meta API ' || r.product_kind || ': ' || r.peak || '% do limite',
            'Taxa de uso >= 80%. Considere reduzir volume de disparo ou escalar mais números.',
            '/platform-health',
            jsonb_build_object('product_kind', r.product_kind, 'peak_pct', r.peak)
          );

          account_id := r.account_id;
          product_kind := r.product_kind;
          peak_pct := r.peak;
          RETURN NEXT;
        END LOOP;
      END;
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ninatlks_app') THEN
          GRANT EXECUTE ON FUNCTION public.rate_limit_alert_tick(numeric) TO ninatlks_app;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      REVOKE EXECUTE ON FUNCTION public.rate_limit_alert_tick(numeric) FROM PUBLIC;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP FUNCTION IF EXISTS public.rate_limit_alert_tick(numeric);`);
  }
}
