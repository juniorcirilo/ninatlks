import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('voice_campaign_contacts')
export class VoiceCampaignContacts {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'campaign_id' })
  campaignId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('text', { name: 'phone_number' })
  phoneNumber!: string;

  @Column('text', { name: 'status', default: 'queued' })
  status!: string;

  @Column('jsonb', { name: 'variables', default: '{}' })
  variables!: Record<string, unknown>;

  @Column('text', { name: 'outcome', nullable: true })
  outcome?: string | null;

  @Column('text', { name: 'transfer_target', nullable: true })
  transferTarget?: string | null;

  @Column('text', { name: 'escalation_reason', nullable: true })
  escalationReason?: string | null;

  @Column('integer', { name: 'call_duration_sec', nullable: true })
  callDurationSec?: number | null;

  @Column('integer', { name: 'cost_cents', nullable: true })
  costCents?: number | null;

  @Column('timestamptz', { name: 'dispatch_after', nullable: true })
  dispatchAfter?: Date | null;

  @Column('timestamptz', { name: 'dispatched_at', nullable: true })
  dispatchedAt?: Date | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column('integer', { name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'to_number', default: '' })
  toNumber!: string;

  @Column('integer', { name: 'attempts', default: 0 })
  attempts!: number;

  @Column('timestamptz', { name: 'last_attempt_at', nullable: true })
  lastAttemptAt?: Date | null;

  @Column('timestamptz', { name: 'next_retry_at', nullable: true })
  nextRetryAt?: Date | null;

  @Column('text', { name: 'provider_call_sid', nullable: true })
  providerCallSid?: string | null;

  @Column('text', { name: 'error_message', nullable: true })
  errorMessage?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('uuid', { name: 'voice_call_id', nullable: true })
  voiceCallId?: string | null;
}
