import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('channel_usage_metrics')
export class ChannelUsageMetrics {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'channel_id', nullable: true })
  channelId?: string | null;

  @Column('text', { name: 'product_kind' })
  productKind!: string;

  @Column('timestamptz', { name: 'bucket_hour' })
  bucketHour!: Date;

  @Column('integer', { name: 'call_count', default: 0 })
  callCount!: number;

  @Column('integer', { name: 'total_time_pct', nullable: true })
  totalTimePct?: number | null;

  @Column('integer', { name: 'total_cputime_pct', nullable: true })
  totalCputimePct?: number | null;

  @Column('integer', { name: 'call_volume_pct', nullable: true })
  callVolumePct?: number | null;

  @Column('jsonb', { name: 'raw_latest', default: '{}' })
  rawLatest!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
