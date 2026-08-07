import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageModule } from '../storage/storage.module';
import { VoiceModule } from '../voice/voice.module';
import { IngestModule } from '../ingest/ingest.module';
import { MediaCleanupProcessor } from './processors/media-cleanup.processor';
import { RateLimitAlertProcessor } from './processors/rate-limit-alert.processor';
import {
  MeetingReminderTickProcessor,
  MeetingNoshowTickProcessor,
} from './processors/meeting-call-dispatch.processor';
import { CadenceTickProcessor } from './processors/cadence-tick.processor';
import { VoiceCampaignDispatchProcessor } from './processors/voice-campaign-dispatch.processor';
import { VoiceCallFinalizePendingProcessor } from './processors/voice-call-finalize-pending.processor';
import { AgentSourcePollProcessor } from './processors/agent-source-poll.processor';
import { JobsSchedulerService } from './jobs-scheduler.service';

/**
 * Fase 7 (jobs/cron). media-cleanup, rate-limit-alert, meeting-reminder-tick,
 * meeting-noshow-tick, cadence-tick and voice-campaign-dispatch are ported.
 * voice-call-finalize-pending (ported from the frontend-app cron route
 * src/routes/api/public/hooks/voice-calls-finalize-pending.ts, not a
 * pg_cron job) is the fallback retry for the ElevenLabs post-call webhook.
 * Still not ported:
 *  - dispatch-retry — depends on the SMS/WhatsApp outbound retry path
 *    (channels-send), which no longer exists in this repo (renamed/removed
 *    at some point — orphaned dependency, not a gap in this port)
 *  - targets an edge function that no longer exists in this repo
 *    (templates-sync, memory-extract-tick, signals-detect-tick,
 *    snooze-wakeup-tick, improvement-tick, messages-retention,
 *    workflow-execute, workflow-cron-tick, crm-sync-worker) — orphaned,
 *    not re-created, or
 *  - calls an external system outside this repo entirely
 *    (debtors-auto-sync-6h → a different Lovable app;
 *    voice-campaign-dispatch-every-minute → a hardcoded OLD Supabase
 *    Cloud project URL with an embedded JWT — duplicate of
 *    voice-campaign-dispatch, dead weight, not ported).
 * This audit is inferred from supabase/migrations/*.sql only — the plan
 * explicitly calls for confirming against a live `select * from cron.job`
 * on the real Supabase project before trusting it fully; that access
 * wasn't available in this environment.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue(
      { name: 'media-cleanup' },
      { name: 'rate-limit-alert' },
      { name: 'meeting-reminder-tick' },
      { name: 'meeting-noshow-tick' },
      { name: 'cadence-tick' },
      { name: 'voice-campaign-dispatch' },
      { name: 'voice-call-finalize-pending' },
      { name: 'agent-source-poll' },
    ),
    StorageModule,
    VoiceModule,
    IngestModule,
  ],
  providers: [
    MediaCleanupProcessor,
    RateLimitAlertProcessor,
    MeetingReminderTickProcessor,
    MeetingNoshowTickProcessor,
    CadenceTickProcessor,
    VoiceCampaignDispatchProcessor,
    VoiceCallFinalizePendingProcessor,
    AgentSourcePollProcessor,
    JobsSchedulerService,
  ],
})
export class JobsModule {}
