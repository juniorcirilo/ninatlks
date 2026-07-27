import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('calendar_integrations')
export class CalendarIntegrations {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('jsonb', { name: 'config', default: '{}' })
  config!: Record<string, unknown>;

  @Column('integer', { name: 'no_show_detection_minutes', default: 15 })
  noShowDetectionMinutes!: number;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
