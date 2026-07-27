import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('integration_sync_queue')
export class IntegrationSyncQueue {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'debt_id' })
  debtId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'external_ref' })
  externalRef!: string;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('integer', { name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'processed_at', nullable: true })
  processedAt?: Date | null;
}
