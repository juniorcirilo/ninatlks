import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { CallFinalizeService } from '../../voice/call-finalize.service';
import { CallClassificationService } from '../../voice/call-classification.service';

/**
 * Ported from src/routes/api/public/hooks/voice-calls-finalize-pending.ts —
 * catches ElevenLabs calls stuck in queued/ringing/in_progress for >90s (the
 * elevenlabs-events webhook never arrived or failed) and finalizes them, plus
 * a second pass re-classifying completed calls whose linked contact still
 * has no name (bounded to once per call via metadata.name_reclassified_at).
 * Cross-account job — DataSource direct, same as the other tick processors.
 * The 3 raw queries below go through SECURITY DEFINER wrappers
 * (`voice_call_finalize_pending_scan`, `voice_call_reclass_candidates_scan`,
 * `voice_call_update_metadata`) since the plain DataSource pool has no
 * `app.current_user_id`/`app.current_account_id` session vars set — under
 * real RLS a raw query here silently returns zero rows instead of erroring.
 * See migrations/20260720180000-VoiceCallFinalizePendingFrontDoor.ts.
 */
@Processor('voice-call-finalize-pending')
export class VoiceCallFinalizePendingProcessor extends WorkerHost {
  private readonly logger = new Logger(VoiceCallFinalizePendingProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly callFinalize: CallFinalizeService,
    private readonly classification: CallClassificationService,
  ) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ processed: number; reclassified: number }> {
    this.logger.log(`running voice-call-finalize-pending tick (job ${job.id})`);

    const cutoff = new Date(Date.now() - 90_000);
    const pending = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.voice_call_finalize_pending_scan($1)`,
      [cutoff],
    );

    let processed = 0;
    for (const c of pending) {
      try {
        await this.callFinalize.finalize(c.id);
      } catch (err) {
        this.logger.warn(
          `finalize failed for call=${c.id}: ${(err as Error).message}`,
        );
      }
      processed++;
    }

    let reclassified = 0;
    try {
      const candidates = await this.dataSource.query<
        {
          id: string;
          metadata: Record<string, unknown> | null;
          contact_id: string | null;
          contact_name: string | null;
        }[]
      >(`SELECT * FROM public.voice_call_reclass_candidates_scan()`);

      for (const c of candidates) {
        if (!c.contact_id) continue;
        if (c.contact_name && c.contact_name.trim()) continue;
        if (c.metadata?.name_reclassified_at) continue;

        try {
          await this.classification.classify(c.id);
          await this.dataSource.query(
            `SELECT public.voice_call_update_metadata($1, $2::jsonb)`,
            [
              c.id,
              JSON.stringify({
                ...(c.metadata ?? {}),
                name_reclassified_at: new Date().toISOString(),
              }),
            ],
          );
          reclassified++;
        } catch (err) {
          this.logger.warn(
            `name reclass failed for call=${c.id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`name reclass pass failed: ${(err as Error).message}`);
    }

    this.logger.log(
      `voice-call-finalize-pending complete: processed=${processed} reclassified=${reclassified}`,
    );
    return { processed, reclassified };
  }
}
