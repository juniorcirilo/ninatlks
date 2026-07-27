import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';

const THRESHOLD_PCT = 80;

/**
 * Ported from supabase/functions/rate-limit-alert — scans Meta API usage
 * for the last hour and notifies one admin per (account, product) at most
 * once per hour when usage crosses 80%. Cross-account (admin) job — goes
 * through `rate_limit_alert_tick`, a SECURITY DEFINER function
 * (migrations/20260720150000-JobsCrossAccountBypass.ts), since this
 * connection has no session/tenant context to scope RLS to and legitimately
 * needs to scan every account in one tick.
 */
@Processor('rate-limit-alert')
export class RateLimitAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(RateLimitAlertProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job): Promise<{ inserted: number }> {
    this.logger.log(`running rate-limit-alert tick (job ${job.id})`);
    const inserted = await this.dataSource.query<
      { account_id: string; product_kind: string; peak_pct: number }[]
    >(`SELECT * FROM public.rate_limit_alert_tick($1)`, [THRESHOLD_PCT]);

    this.logger.log(`rate-limit-alert tick: inserted=${inserted.length}`);
    return { inserted: inserted.length };
  }
}
