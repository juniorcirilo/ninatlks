import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('company_settings')
export class CompanySettings {
  @PrimaryColumn('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'company_name' })
  companyName!: string;

  @Column('text', { name: 'cnpj', nullable: true })
  cnpj?: string | null;

  @Column('text', { name: 'support_phone', nullable: true })
  supportPhone?: string | null;

  @Column('text', { name: 'reply_email', nullable: true })
  replyEmail?: string | null;

  @Column('text', { name: 'logo_url', nullable: true })
  logoUrl?: string | null;

  @Column('text', { name: 'legal_footer', nullable: true })
  legalFooter?: string | null;

  @Column('jsonb', { name: 'collection_window' })
  collectionWindow!: Record<string, unknown>;

  @Column('integer', { name: 'max_attempts_per_debtor', default: 5 })
  maxAttemptsPerDebtor!: number;

  @Column('integer', { name: 'attempt_gap_minutes', default: 180 })
  attemptGapMinutes!: number;

  @Column('integer', { name: 'recording_retention_days', default: 90 })
  recordingRetentionDays!: number;

  @Column('numeric', {
    name: 'default_discount_pct',
    nullable: true,
    default: 10.0,
  })
  defaultDiscountPct?: number | null;

  @Column('integer', {
    name: 'default_max_installments',
    nullable: true,
    default: 6,
  })
  defaultMaxInstallments?: number | null;

  @Column('boolean', { name: 'record_calls', default: true })
  recordCalls!: boolean;

  @Column('uuid', { name: 'default_agent_id', nullable: true })
  defaultAgentId?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
