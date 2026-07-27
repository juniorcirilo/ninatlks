import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('scheduled_meetings')
export class ScheduledMeetings {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'provider_event_id' })
  providerEventId!: string;

  @Column('text', { name: 'event_type_uri', nullable: true })
  eventTypeUri?: string | null;

  @Column('text', { name: 'title', nullable: true })
  title?: string | null;

  @Column('timestamptz', { name: 'starts_at' })
  startsAt!: Date;

  @Column('timestamptz', { name: 'ends_at', nullable: true })
  endsAt?: Date | null;

  @Column('text', { name: 'meeting_url', nullable: true })
  meetingUrl?: string | null;

  @Column('text', { name: 'invitee_name', nullable: true })
  inviteeName?: string | null;

  @Column('text', { name: 'invitee_email', nullable: true })
  inviteeEmail?: string | null;

  @Column('text', { name: 'invitee_phone', nullable: true })
  inviteePhone?: string | null;

  @Column('text', { name: 'status', default: 'scheduled' })
  status!: string;

  @Column('text', { name: 'cancellation_reason', nullable: true })
  cancellationReason?: string | null;

  @Column('timestamptz', { name: 'attended_at', nullable: true })
  attendedAt?: Date | null;

  @Column('timestamptz', { name: 'detected_no_show_at', nullable: true })
  detectedNoShowAt?: Date | null;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('uuid', { name: 'attendee_user_id', nullable: true })
  attendeeUserId?: string | null;

  @Column('jsonb', { name: 'briefing', nullable: true })
  briefing?: Record<string, unknown> | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('uuid', { name: 'sdr_call_id', nullable: true })
  sdrCallId?: string | null;

  @Column('smallint', { name: 'duration_minutes', nullable: true })
  durationMinutes?: number | null;

  @Column('uuid', { name: 'reminder_call_id', nullable: true })
  reminderCallId?: string | null;

  @Column('timestamptz', { name: 'reminder_sent_at', nullable: true })
  reminderSentAt?: Date | null;

  @Column('timestamptz', { name: 'confirmed_at', nullable: true })
  confirmedAt?: Date | null;

  @Column('uuid', { name: 'reschedule_call_id', nullable: true })
  rescheduleCallId?: string | null;

  @Column('smallint', { name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column('smallint', { name: 'max_retries', default: 2 })
  maxRetries!: number;

  @Column('uuid', { name: 'doctor_id', nullable: true })
  doctorId?: string | null;

  @Column('text', { name: 'modality', nullable: true })
  modality?: string | null;
}
