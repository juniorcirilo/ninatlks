import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workflow_runs')
export class WorkflowRuns {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'workflow_id' })
  workflowId!: string;

  @Column('bigint', { name: 'event_id', nullable: true })
  eventId?: string | null;

  @Column('text', { name: 'trigger_type' })
  triggerType!: string;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('jsonb', { name: 'input_payload', default: '{}' })
  inputPayload!: Record<string, unknown>;

  @Column('jsonb', { name: 'context', default: '{}' })
  context!: Record<string, unknown>;

  @Column('jsonb', { name: 'action_results', default: '[]' })
  actionResults!: Record<string, unknown>;

  @Column('text', { name: 'error_message', nullable: true })
  errorMessage?: string | null;

  @Column('integer', { name: 'error_action_index', nullable: true })
  errorActionIndex?: number | null;

  @Column('integer', { name: 'duration_ms', nullable: true })
  durationMs?: number | null;

  @Column('timestamptz', { name: 'scheduled_at' })
  scheduledAt!: Date;

  @Column('timestamptz', { name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
