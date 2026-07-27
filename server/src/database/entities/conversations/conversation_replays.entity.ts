import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('conversation_replays')
export class ConversationReplays {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'original_conversation_id' })
  originalConversationId!: string;

  @Column('bigint', { name: 'checkpoint_id', nullable: true })
  checkpointId?: string | null;

  @Column('text', { name: 'edited_message' })
  editedMessage!: string;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('jsonb', { name: 'transcript', default: '[]' })
  transcript!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'queued' })
  status!: string;

  @Column('text', { name: 'simulated_outcome', nullable: true })
  simulatedOutcome?: string | null;

  @Column('numeric', { name: 'outcome_score', nullable: true })
  outcomeScore?: number | null;

  @Column('numeric', { name: 'outcome_delta', nullable: true })
  outcomeDelta?: number | null;

  @Column('text', { name: 'judge_notes', nullable: true })
  judgeNotes?: string | null;

  @Column('numeric', { name: 'cost_cents', default: 0 })
  costCents!: number;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;
}
