import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_deals')
export class CrmDeals {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('uuid', { name: 'pipeline_id', nullable: true })
  pipelineId?: string | null;

  @Column('uuid', { name: 'stage_id', nullable: true })
  stageId?: string | null;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'provider_deal_id' })
  providerDealId!: string;

  @Column('text', { name: 'title' })
  title!: string;

  @Column('integer', { name: 'value_cents', nullable: true })
  valueCents?: number | null;

  @Column('text', { name: 'currency', nullable: true, default: 'BRL' })
  currency?: string | null;

  @Column('text', { name: 'status', default: 'open' })
  status!: string;

  @Column('text', { name: 'owner_id', nullable: true })
  ownerId?: string | null;

  @Column('date', { name: 'expected_close_date', nullable: true })
  expectedCloseDate?: Date | null;

  @Column('timestamptz', { name: 'won_at', nullable: true })
  wonAt?: Date | null;

  @Column('timestamptz', { name: 'lost_at', nullable: true })
  lostAt?: Date | null;

  @Column('text', { name: 'lost_reason', nullable: true })
  lostReason?: string | null;

  @Column('text', { name: 'last_sync_direction', nullable: true })
  lastSyncDirection?: string | null;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
