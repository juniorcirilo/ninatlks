import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('eval_runs')
export class EvalRuns {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('bigint', { name: 'prompt_version_id', nullable: true })
  promptVersionId?: string | null;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('bigint', { name: 'baseline_prompt_version_id', nullable: true })
  baselinePromptVersionId?: string | null;

  @Column('text', { name: 'status', default: 'queued' })
  status!: string;

  @Column('integer', { name: 'scenario_count', default: 0 })
  scenarioCount!: number;

  @Column('integer', { name: 'conversations_run', default: 0 })
  conversationsRun!: number;

  @Column('numeric', { name: 'win_rate', nullable: true })
  winRate?: number | null;

  @Column('numeric', { name: 'avg_outcome_score', nullable: true })
  avgOutcomeScore?: number | null;

  @Column('numeric', { name: 'avg_turns', nullable: true })
  avgTurns?: number | null;

  @Column('numeric', { name: 'avg_latency_ms', nullable: true })
  avgLatencyMs?: number | null;

  @Column('numeric', { name: 'total_cost_cents', default: 0 })
  totalCostCents!: number;

  @Column('text', { name: 'verdict', nullable: true })
  verdict?: string | null;

  @Column('text', { name: 'verdict_reason', nullable: true })
  verdictReason?: string | null;

  @Column('text', { name: 'error_message', nullable: true })
  errorMessage?: string | null;

  @Column('timestamptz', { name: 'started_at', nullable: true })
  startedAt?: Date | null;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
