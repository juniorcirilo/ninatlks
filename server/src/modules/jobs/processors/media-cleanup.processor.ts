import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { StorageService } from '../../storage/storage.service';

const VOICE_RECORDING_TTL_DAYS = Number(
  process.env.VOICE_RECORDING_TTL_DAYS ?? 90,
);
const ATTACHMENT_TTL_DAYS = Number(process.env.ATTACHMENT_TTL_DAYS ?? 180);
const TELEMETRY_TTL_DAYS = Number(process.env.TELEMETRY_TTL_DAYS ?? 90);

/**
 * Ported from supabase/functions/media-cleanup — daily storage/DB retention
 * sweep. Runs cross-account (admin), so it goes through DataSource directly
 * rather than the per-request TenantTxHost, same as the guards/SessionService
 * exception documented there.
 */
@Processor('media-cleanup')
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<Record<string, number>> {
    this.logger.log(`running media-cleanup tick (job ${job.id})`);
    const stats: Record<string, number> = {};

    stats.memory_nodes_expired = await this.deleteExpired(
      'customer_memory_nodes',
      'expires_at',
    );
    // csat_surveys has no created_at column (pre-existing schema bug in the
    // ported migrations — same class of issue as the contact_tags/added_by
    // and voice_calls/contact_id bugs found earlier) — sent_at is the
    // closest meaningful "age" column.
    stats.csat_surveys_old = await this.deleteOlder(
      'csat_surveys',
      'sent_at',
      30,
    );
    stats.channel_usage_old = await this.deleteOlder(
      'channel_usage_metrics',
      'created_at',
      180,
    );
    stats.webhook_deliveries_old = await this.deleteOlder(
      'webhook_deliveries',
      'created_at',
      TELEMETRY_TTL_DAYS,
    );
    stats.recordings_cleaned = await this.cleanupRecordings();
    // Orphan attachment scan — a documented no-op/TODO in the original
    // edge function too (listing storage objects per-account is expensive
    // without a paginated inventory); left as 0 here rather than inventing
    // new logic.
    stats.attachments_cleaned = 0;
    void ATTACHMENT_TTL_DAYS;

    this.logger.log(`media-cleanup complete: ${JSON.stringify(stats)}`);
    return stats;
  }

  private async deleteExpired(table: string, column: string): Promise<number> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `DELETE FROM public.${table} WHERE ${column} < now() RETURNING id`,
    );
    return rows.length;
  }

  private async deleteOlder(
    table: string,
    column: string,
    days: number,
  ): Promise<number> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `DELETE FROM public.${table} WHERE ${column} < now() - ($1 || ' days')::interval RETURNING id`,
      [days],
    );
    return rows.length;
  }

  private async cleanupRecordings(): Promise<number> {
    const cutoff = `now() - interval '${VOICE_RECORDING_TTL_DAYS} days'`;
    const rows = await this.dataSource.query<
      { id: string; recording_storage_path: string }[]
    >(
      `SELECT id, recording_storage_path FROM public.voice_calls
       WHERE created_at < ${cutoff} AND recording_storage_path IS NOT NULL
       LIMIT 500`,
    );
    let removed = 0;
    for (const row of rows) {
      const path = row.recording_storage_path;
      const [maybeBucket, ...rest] = path.split('/');
      const bucket = rest.length ? maybeBucket : 'voice-recordings';
      const key = rest.length ? rest.join('/') : path;
      try {
        await this.storage.deleteObject(bucket, key);
        await this.dataSource.query(
          `UPDATE public.voice_calls SET recording_storage_path = NULL WHERE id = $1`,
          [row.id],
        );
        removed++;
      } catch (err) {
        this.logger.warn(
          `storage remove failed for ${path}: ${(err as Error).message}`,
        );
      }
    }
    return removed;
  }
}
