import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workflows')
export class Workflows {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('text', { name: 'trigger_type' })
  triggerType!: string;

  @Column('jsonb', { name: 'trigger_config', default: '{}' })
  triggerConfig!: Record<string, unknown>;

  @Column('jsonb', { name: 'conditions', default: '[]' })
  conditions!: Record<string, unknown>;

  @Column('jsonb', { name: 'actions', default: '[]' })
  actions!: Record<string, unknown>;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('integer', { name: 'version', default: 1 })
  version!: number;

  @Column('integer', { name: 'success_count', default: 0 })
  successCount!: number;

  @Column('integer', { name: 'failure_count', default: 0 })
  failureCount!: number;

  @Column('timestamptz', { name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('jsonb', { name: 'trigger', default: '{}' })
  trigger!: Record<string, unknown>;

  @Column('text', { name: 'last_run_status', nullable: true })
  lastRunStatus?: string | null;

  @Column('integer', { name: 'run_count', default: 0 })
  runCount!: number;
}
