import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Registers the repeatable jobs. BullMQ dedupes repeatable jobs by their
 * (name, pattern, jobId) tuple, so calling `upsertJobScheduler` on every
 * boot is idempotent — safe for now with a single API replica. The plan
 * calls for moving this to a single deploy-time script once there's more
 * than one replica, to avoid subtly different schedules racing on deploy.
 */
@Injectable()
export class JobsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(JobsSchedulerService.name);

  constructor(
    @InjectQueue('media-cleanup') private readonly mediaCleanupQueue: Queue,
    @InjectQueue('rate-limit-alert')
    private readonly rateLimitAlertQueue: Queue,
    @InjectQueue('meeting-reminder-tick')
    private readonly meetingReminderQueue: Queue,
    @InjectQueue('meeting-noshow-tick')
    private readonly meetingNoshowQueue: Queue,
    @InjectQueue('cadence-tick')
    private readonly cadenceTickQueue: Queue,
    @InjectQueue('voice-campaign-dispatch')
    private readonly voiceCampaignDispatchQueue: Queue,
    @InjectQueue('voice-call-finalize-pending')
    private readonly voiceCallFinalizePendingQueue: Queue,
    @InjectQueue('agent-source-poll')
    private readonly agentSourcePollQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.mediaCleanupQueue.upsertJobScheduler(
      'media-cleanup-daily',
      { pattern: '10 3 * * *' }, // 03:10 daily, matches original pg_cron schedule
      { name: 'tick' },
    );
    await this.rateLimitAlertQueue.upsertJobScheduler(
      'rate-limit-alert-10min',
      { pattern: '*/10 * * * *' },
      { name: 'tick' },
    );
    await this.meetingReminderQueue.upsertJobScheduler(
      'meeting-reminder-tick-1min',
      { pattern: '* * * * *' }, // matches nexus-meeting-reminder-tick (1/min)
      { name: 'tick' },
    );
    await this.meetingNoshowQueue.upsertJobScheduler(
      'meeting-noshow-tick-5min',
      { pattern: '*/5 * * * *' }, // matches nexus-meeting-noshow-tick (5/min)
      { name: 'tick' },
    );
    await this.cadenceTickQueue.upsertJobScheduler(
      'cadence-tick-5min',
      { pattern: '*/5 * * * *' }, // matches nexus-cadence-tick (5/min)
      { name: 'tick' },
    );
    await this.voiceCampaignDispatchQueue.upsertJobScheduler(
      'voice-campaign-dispatch-1min',
      { pattern: '* * * * *' }, // matches voice-campaign-dispatch-every-minute
      { name: 'tick' },
    );
    await this.voiceCallFinalizePendingQueue.upsertJobScheduler(
      'voice-call-finalize-pending-2min',
      { pattern: '*/2 * * * *' }, // matches voice-calls-finalize-pending-2m
      { name: 'tick' },
    );
    // De minuto em minuto porque quem decide a janela é cada fonte
    // (schedule_minutes, mínimo 5); o tick só varre quem já venceu.
    await this.agentSourcePollQueue.upsertJobScheduler(
      'agent-source-poll-1min',
      { pattern: '* * * * *' },
      { name: 'tick' },
    );
    this.logger.log(
      'Repeatable jobs scheduled: media-cleanup, rate-limit-alert, meeting-reminder-tick, meeting-noshow-tick, cadence-tick, voice-campaign-dispatch, voice-call-finalize-pending, agent-source-poll',
    );
  }
}
