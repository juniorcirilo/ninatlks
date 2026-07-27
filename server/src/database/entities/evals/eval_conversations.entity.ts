import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('eval_conversations')
export class EvalConversations {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('bigint', { name: 'eval_run_id' })
  evalRunId!: string;

  @Column('bigint', { name: 'scenario_id' })
  scenarioId!: string;

  @Column('jsonb', { name: 'transcript', default: '[]' })
  transcript!: Record<string, unknown>;

  @Column('integer', { name: 'turns', default: 0 })
  turns!: number;

  @Column('text', { name: 'outcome', nullable: true })
  outcome?: string | null;

  @Column('numeric', { name: 'outcome_score', nullable: true })
  outcomeScore?: number | null;

  @Column('text', { name: 'judge_notes', nullable: true })
  judgeNotes?: string | null;

  @Column('integer', { name: 'decisive_turn_index', nullable: true })
  decisiveTurnIndex?: number | null;

  @Column('numeric', { name: 'cost_cents', default: 0 })
  costCents!: number;

  @Column('integer', { name: 'duration_ms', nullable: true })
  durationMs?: number | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
