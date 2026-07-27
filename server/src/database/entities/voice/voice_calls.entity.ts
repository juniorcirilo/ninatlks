import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('voice_calls')
export class VoiceCalls {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'phone_number_id', nullable: true })
  phoneNumberId?: string | null;

  @Column('uuid', { name: 'conversation_id', nullable: true })
  conversationId?: string | null;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('uuid', { name: 'handled_by_user_id', nullable: true })
  handledByUserId?: string | null;

  @Column('text', { name: 'direction' }) // Postgres enum "voice_call_direction" — stored/read as text; DB still enforces the enum constraint.
  direction!: string;

  @Column('text', { name: 'status', default: 'queued' }) // Postgres enum "voice_call_status" — stored/read as text; DB still enforces the enum constraint.
  status!: string;

  @Column('text', { name: 'provider', default: 'twilio' })
  provider!: string;

  @Column('text', { name: 'provider_call_sid', nullable: true })
  providerCallSid?: string | null;

  @Column('text', { name: 'from_number' })
  fromNumber!: string;

  @Column('text', { name: 'to_number' })
  toNumber!: string;

  @Column('integer', { name: 'duration_seconds', default: 0 })
  durationSeconds!: number;

  @Column('integer', { name: 'total_cost_cents', default: 0 })
  totalCostCents!: number;

  @Column('text', { name: 'recording_url', nullable: true })
  recordingUrl?: string | null;

  @Column('jsonb', { name: 'transcript', default: '[]' })
  transcript!: Record<string, unknown>;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column('timestamptz', { name: 'ended_at', nullable: true })
  endedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'recording_sid', nullable: true })
  recordingSid?: string | null;

  @Column('text', { name: 'recording_storage_path', nullable: true })
  recordingStoragePath?: string | null;

  @Column('integer', { name: 'recording_duration_sec', nullable: true })
  recordingDurationSec?: number | null;

  @Column('text', {
    name: 'transcription_status',
    nullable: true,
    default: 'idle',
  })
  transcriptionStatus?: string | null;

  @Column('text', { name: 'transcription_provider', nullable: true })
  transcriptionProvider?: string | null;

  @Column('text', { name: 'transcription_error', nullable: true })
  transcriptionError?: string | null;

  @Column('timestamptz', { name: 'transcription_completed_at', nullable: true })
  transcriptionCompletedAt?: Date | null;

  @Column('text', { name: 'source_id', nullable: true })
  sourceId?: string | null;

  @Column('text', { name: 'outcome_category', nullable: true })
  outcomeCategory?: string | null;

  @Column('numeric', { name: 'outcome_confidence', nullable: true })
  outcomeConfidence?: number | null;

  @Column('text', { name: 'outcome_summary', nullable: true })
  outcomeSummary?: string | null;

  @Column('timestamptz', { name: 'outcome_classified_at', nullable: true })
  outcomeClassifiedAt?: Date | null;

  @Column('integer', { name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column('timestamptz', { name: 'next_retry_at', nullable: true })
  nextRetryAt?: Date | null;

  @Column('timestamptz', { name: 'consent_recorded_at', nullable: true })
  consentRecordedAt?: Date | null;

  @Column('jsonb', { name: 'sentiment', nullable: true })
  sentiment?: Record<string, unknown> | null;

  @Column('jsonb', { name: 'classification', nullable: true })
  classification?: Record<string, unknown> | null;

  @Column('text', { name: 'ai_summary', nullable: true })
  aiSummary?: string | null;
}
