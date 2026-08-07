import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('follow_up_executions')
export class FollowUpExecutions {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'cadence_id' })
  cadenceId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('timestamptz', { name: 'enrolled_at' })
  enrolledAt!: Date;

  @Column('smallint', { name: 'current_step', default: 0 })
  currentStep!: number;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('timestamptz', { name: 'next_run_at', nullable: true })
  nextRunAt?: Date | null;

  @Column('timestamptz', { name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column('uuid', { name: 'waiting_call_id', nullable: true })
  waitingCallId?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
