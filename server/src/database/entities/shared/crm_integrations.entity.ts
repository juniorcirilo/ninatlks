import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_integrations')
export class CrmIntegrations {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('jsonb', { name: 'config', default: '{}' })
  config!: Record<string, unknown>;

  @Column('jsonb', { name: 'field_map', default: '{}' })
  fieldMap!: Record<string, unknown>;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @Column('timestamptz', { name: 'last_event_at', nullable: true })
  lastEventAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
