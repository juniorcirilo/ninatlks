import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contacts')
export class Contacts {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name', nullable: true })
  name?: string | null;

  @Column('text', { name: 'email', nullable: true })
  email?: string | null;

  @Column('text', { name: 'phone_number', nullable: true })
  phoneNumber?: string | null;

  @Column('text', { name: 'identifier', nullable: true })
  identifier?: string | null;

  @Column('jsonb', { name: 'additional_attributes', default: '{}' })
  additionalAttributes!: Record<string, unknown>;

  @Column('jsonb', { name: 'custom_attributes', default: '{}' })
  customAttributes!: Record<string, unknown>;

  @Column('text', { name: 'location', nullable: true })
  location?: string | null;

  @Column('text', { name: 'country_code', nullable: true })
  countryCode?: string | null;

  @Column('boolean', { name: 'blocked', default: false })
  blocked!: boolean;

  @Column('uuid', { name: 'company_id', nullable: true })
  companyId?: string | null;

  @Column('timestamptz', { name: 'last_activity_at', nullable: true })
  lastActivityAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @Column('text', {
    name: 'timezone',
    nullable: true,
    default: 'America/Sao_Paulo',
  })
  timezone?: string | null;

  @Column('uuid', { name: 'stage_id', nullable: true })
  stageId?: string | null;

  @Column('smallint', { name: 'score', default: 0 })
  score!: number;

  @Column('text', { name: 'source', nullable: true })
  source?: string | null;

  @Column('timestamptz', { name: 'stage_changed_at', nullable: true })
  stageChangedAt?: Date | null;

  @Column('jsonb', { name: 'briefing', nullable: true })
  briefing?: Record<string, unknown> | null;

  @Column('text', { name: 'last_sentiment', nullable: true })
  lastSentiment?: string | null;

  @Column('numeric', { name: 'last_sentiment_score', nullable: true })
  lastSentimentScore?: number | null;

  @Column('timestamptz', { name: 'auto_moved_at', nullable: true })
  autoMovedAt?: Date | null;

  @Column('text', { name: 'lifecycle_stage', default: 'lead' }) // Postgres enum "contact_lifecycle_stage" — stored/read as text; DB still enforces the enum constraint.
  lifecycleStage!: string;

  @Column('text', { name: 'operational_status', default: 'new' }) // Postgres enum "contact_operational_status" — stored/read as text; DB still enforces the enum constraint.
  operationalStatus!: string;

  @Column('uuid', { name: 'owner_user_id', nullable: true })
  ownerUserId?: string | null;

  @Column('timestamptz', { name: 'last_call_at', nullable: true })
  lastCallAt?: Date | null;

  @Column('timestamptz', { name: 'last_whatsapp_at', nullable: true })
  lastWhatsappAt?: Date | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;
}
