import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('voice_campaigns')
export class VoiceCampaigns {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('text', { name: 'voice_id', nullable: true })
  voiceId?: string | null;

  @Column('text', { name: 'language_code', nullable: true, default: 'pt-BR' })
  languageCode?: string | null;

  @Column('text', { name: 'script_mode', default: 'conversational' })
  scriptMode!: string;

  @Column('text', { name: 'opening_script', nullable: true })
  openingScript?: string | null;

  @Column('text', { name: 'system_prompt', nullable: true })
  systemPrompt?: string | null;

  @Column('uuid', { name: 'phone_number_id', nullable: true })
  phoneNumberId?: string | null;

  @Column('jsonb', { name: 'escalation_rules', default: '[]' })
  escalationRules!: Record<string, unknown>;

  @Column('integer', { name: 'max_call_duration_sec', default: 300 })
  maxCallDurationSec!: number;

  @Column('boolean', { name: 'voicemail_detection', default: true })
  voicemailDetection!: boolean;

  @Column('boolean', { name: 'record_call', default: true })
  recordCall!: boolean;

  @Column('text', { name: 'status', default: 'draft' })
  status!: string;

  @Column('timestamptz', { name: 'scheduled_for', nullable: true })
  scheduledFor?: Date | null;

  @Column('timestamptz', { name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column('timestamptz', { name: 'completed_at', nullable: true })
  completedAt?: Date | null;

  @Column('integer', { name: 'contact_count', default: 0 })
  contactCount!: number;

  @Column('integer', { name: 'placed_count', default: 0 })
  placedCount!: number;

  @Column('integer', { name: 'connected_count', default: 0 })
  connectedCount!: number;

  @Column('integer', { name: 'escalated_count', default: 0 })
  escalatedCount!: number;

  @Column('integer', { name: 'voicemail_count', default: 0 })
  voicemailCount!: number;

  @Column('integer', { name: 'failed_count', default: 0 })
  failedCount!: number;

  @Column('uuid', { name: 'triggered_by_id', nullable: true })
  triggeredById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'mode', default: 'script_readback' })
  mode!: string;

  @Column('text', { name: 'from_number', default: '' })
  fromNumber!: string;

  @Column('text', { name: 'escalation_target_number', nullable: true })
  escalationTargetNumber?: string | null;

  @Column('jsonb', {
    name: 'escalation_keywords',
    default:
      '["atendente", "humano", "gerente", "supervisor", "operador", "representante"]',
  })
  escalationKeywords!: Record<string, unknown>;

  @Column('integer', { name: 'max_concurrent', default: 5 })
  maxConcurrent!: number;

  @Column('integer', { name: 'retry_attempts', default: 1 })
  retryAttempts!: number;

  @Column('integer', { name: 'retry_delay_minutes', default: 30 })
  retryDelayMinutes!: number;

  @Column('timestamptz', { name: 'scheduled_at', nullable: true })
  scheduledAt?: Date | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column('integer', { name: 'total_contacts', default: 0 })
  totalContacts!: number;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('jsonb', { name: 'allowed_hours_local', nullable: true })
  allowedHoursLocal?: Record<string, unknown> | null;

  @Column('integer', { name: 'max_attempts_per_day', nullable: true })
  maxAttemptsPerDay?: number | null;

  @Column('integer', { name: 'min_minutes_between_attempts', nullable: true })
  minMinutesBetweenAttempts?: number | null;

  @Column('boolean', {
    name: 'disclaimer_enabled',
    nullable: true,
    default: true,
  })
  disclaimerEnabled?: boolean | null;

  @Column('timestamptz', { name: 'canceled_at', nullable: true })
  canceledAt?: Date | null;

  @Column('integer', { name: 'canceled_after_placed', nullable: true })
  canceledAfterPlaced?: number | null;

  @Column('boolean', { name: 'test_mode', default: false })
  testMode!: boolean;

  @Column('text', { name: 'campaign_kind', default: 'sdr' })
  campaignKind!: string;

  @Column('jsonb', { name: 'collection_config' })
  collectionConfig!: Record<string, unknown>;

  @Column('integer', { name: 'max_calls_per_day', nullable: true })
  maxCallsPerDay?: number | null;

  @Column('integer', { name: 'max_calls_per_week', nullable: true })
  maxCallsPerWeek?: number | null;

  @Column('integer', { name: 'max_calls_per_month', nullable: true })
  maxCallsPerMonth?: number | null;

  @Column('integer', { name: 'max_messages_per_day', nullable: true })
  maxMessagesPerDay?: number | null;

  @Column('integer', { name: 'max_messages_per_week', nullable: true })
  maxMessagesPerWeek?: number | null;

  @Column('integer', { name: 'max_messages_per_month', nullable: true })
  maxMessagesPerMonth?: number | null;

  @Column('jsonb', { name: 'retry_rules', default: '{}' })
  retryRules!: Record<string, unknown>;
}
