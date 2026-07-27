import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  resolveOutboundPhoneAndPersona,
  resolveElevenLabsApiKey,
  callElevenLabsOutbound,
  buildFollowupSystemPrompt,
  formatMeetingTimeHuman,
  createOutboundVoiceCallRow,
  finalizeOutboundVoiceCall,
} from './el-outbound-cron.util';

interface DueMeetingBase {
  id: string;
  account_id: string;
  starts_at: string;
  invitee_phone: string;
  invitee_name: string | null;
}
type ReminderDueMeeting = DueMeetingBase;
interface NoshowDueMeeting extends DueMeetingBase {
  retry_count: number;
  max_retries: number;
}

/** Ported from supabase/functions/meeting-reminder-tick. */
@Processor('meeting-reminder-tick')
export class MeetingReminderTickProcessor extends WorkerHost {
  private readonly logger = new Logger(MeetingReminderTickProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ checked: number; dispatched: number; skipped: number }> {
    this.logger.log(`running meeting-reminder-tick (job ${job.id})`);
    const due = await this.dataSource.query<ReminderDueMeeting[]>(
      `SELECT id, account_id, starts_at, invitee_phone, invitee_name
       FROM public.meeting_reminder_due($1)`,
      [25],
    );

    let dispatched = 0;
    let skipped = 0;
    for (const m of due) {
      try {
        await dispatchReminder(this.dataSource, m);
        dispatched++;
      } catch (err) {
        this.logger.warn(`meeting=${m.id} failed: ${(err as Error).message}`);
        await this.dataSource.query(
          `UPDATE scheduled_meetings SET reminder_sent_at = now() WHERE id = $1`,
          [m.id],
        );
        skipped++;
      }
    }
    this.logger.log(
      `meeting-reminder-tick complete: checked=${due.length} dispatched=${dispatched} skipped=${skipped}`,
    );
    return { checked: due.length, dispatched, skipped };
  }
}

/** Ported from supabase/functions/meeting-noshow-tick. */
@Processor('meeting-noshow-tick')
export class MeetingNoshowTickProcessor extends WorkerHost {
  private readonly logger = new Logger(MeetingNoshowTickProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(
    job: Job,
  ): Promise<{ checked: number; dispatched: number; skipped: number }> {
    this.logger.log(`running meeting-noshow-tick (job ${job.id})`);
    const due = await this.dataSource.query<NoshowDueMeeting[]>(
      `SELECT id, account_id, starts_at, retry_count, max_retries, invitee_phone, invitee_name
       FROM public.meeting_noshow_due($1)`,
      [25],
    );

    let dispatched = 0;
    let skipped = 0;
    for (const m of due) {
      try {
        await this.dataSource.query(
          `UPDATE scheduled_meetings SET detected_no_show_at = now(), retry_count = retry_count + 1 WHERE id = $1`,
          [m.id],
        );
        await dispatchReschedule(this.dataSource, m);
        dispatched++;
      } catch (err) {
        this.logger.warn(`meeting=${m.id} failed: ${(err as Error).message}`);
        skipped++;
      }
    }
    this.logger.log(
      `meeting-noshow-tick complete: checked=${due.length} dispatched=${dispatched} skipped=${skipped}`,
    );
    return { checked: due.length, dispatched, skipped };
  }
}

async function dispatchReminder(
  dataSource: DataSource,
  meeting: ReminderDueMeeting,
): Promise<void> {
  const { phone, personaId, persona } = await resolveOutboundPhoneAndPersona(
    dataSource,
    meeting.account_id,
  );
  const elKey = await resolveElevenLabsApiKey(dataSource, meeting.account_id);

  const callId = await createOutboundVoiceCallRow(dataSource, {
    accountId: meeting.account_id,
    phoneId: phone.id,
    personaId,
    fromNumber: phone.e164,
    toNumber: meeting.invitee_phone,
    metadata: {
      source: 'meeting-reminder-tick',
      meeting_id: meeting.id,
      call_purpose: 'reminder',
    },
  });

  const startsHuman = formatMeetingTimeHuman(meeting.starts_at);
  const leadName = (meeting.invitee_name ?? '').split(' ')[0] || 'olá';
  const dynamicVariables: Record<string, string> = {
    call_purpose: 'reminder',
    meeting_id: meeting.id,
    meeting_starts_at_iso: meeting.starts_at,
    meeting_starts_at_human: startsHuman,
    lead_name: leadName,
    agent_name: persona.name ?? 'Nina',
    voice_call_id: callId,
  };
  const firstMessage = `Oi ${leadName}, é a Nina lembrando da nossa reunião ${startsHuman}. Tudo confirmado?`;

  const el = await callElevenLabsOutbound({
    elKey,
    agentId: persona.elevenlabs_agent_id!,
    elPhoneId: phone.elevenlabs_phone_number_id!,
    toNumber: meeting.invitee_phone,
    firstMessage,
    systemPrompt: buildFollowupSystemPrompt(persona.system_prompt),
    voiceCloneId: persona.voice_clone_id,
    dynamicVariables,
  });
  await finalizeOutboundVoiceCall(dataSource, callId, el);

  await dataSource.query(
    `UPDATE scheduled_meetings SET reminder_call_id = $2, reminder_sent_at = now() WHERE id = $1`,
    [meeting.id, callId],
  );
}

async function dispatchReschedule(
  dataSource: DataSource,
  meeting: NoshowDueMeeting,
): Promise<void> {
  const { phone, personaId, persona } = await resolveOutboundPhoneAndPersona(
    dataSource,
    meeting.account_id,
  );
  const elKey = await resolveElevenLabsApiKey(dataSource, meeting.account_id);

  const callId = await createOutboundVoiceCallRow(dataSource, {
    accountId: meeting.account_id,
    phoneId: phone.id,
    personaId,
    fromNumber: phone.e164,
    toNumber: meeting.invitee_phone,
    metadata: {
      source: 'meeting-noshow-tick',
      meeting_id: meeting.id,
      call_purpose: 'noshow_reschedule',
    },
  });

  const startsHuman = formatMeetingTimeHuman(meeting.starts_at);
  const leadName = (meeting.invitee_name ?? '').split(' ')[0] || 'olá';
  const dynamicVariables: Record<string, string> = {
    call_purpose: 'noshow_reschedule',
    meeting_id: meeting.id,
    meeting_starts_at_iso: meeting.starts_at,
    meeting_starts_at_human: startsHuman,
    lead_name: leadName,
    agent_name: persona.name ?? 'Nina',
    voice_call_id: callId,
  };
  const firstMessage = `Oi ${leadName}, é a Nina. Notei que você não conseguiu participar da nossa reunião ${startsHuman}. Tudo certo?`;

  const el = await callElevenLabsOutbound({
    elKey,
    agentId: persona.elevenlabs_agent_id!,
    elPhoneId: phone.elevenlabs_phone_number_id!,
    toNumber: meeting.invitee_phone,
    firstMessage,
    systemPrompt: buildFollowupSystemPrompt(persona.system_prompt),
    voiceCloneId: persona.voice_clone_id,
    dynamicVariables,
  });
  await finalizeOutboundVoiceCall(dataSource, callId, el);

  await dataSource.query(
    `UPDATE scheduled_meetings SET reschedule_call_id = $2 WHERE id = $1`,
    [meeting.id, callId],
  );
}
