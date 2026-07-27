import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workflow_events')
export class WorkflowEvents {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'source' })
  source!: string;

  @Column('text', { name: 'event_type' })
  eventType!: string;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('uuid', { name: 'conversation_id', nullable: true })
  conversationId?: string | null;

  @Column('integer', { name: 'matched_workflow_count', default: 0 })
  matchedWorkflowCount!: number;

  @Column('timestamptz', { name: 'processed_at', nullable: true })
  processedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('text', { name: 'provider', nullable: true })
  provider?: string | null;

  @Column('text', { name: 'dedup_key', nullable: true })
  dedupKey?: string | null;

  @Column('text', { name: 'error', nullable: true })
  error?: string | null;

  @Column('timestamptz', { name: 'received_at' })
  receivedAt!: Date;
}
