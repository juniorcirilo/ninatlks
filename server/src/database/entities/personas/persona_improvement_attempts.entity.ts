import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('persona_improvement_attempts')
export class PersonaImprovementAttempts {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'persona_id' })
  personaId!: string;

  @Column('bigint', { name: 'baseline_prompt_version_id', nullable: true })
  baselinePromptVersionId?: string | null;

  @Column('bigint', { name: 'candidate_prompt_version_id', nullable: true })
  candidatePromptVersionId?: string | null;

  @Column('bigint', { name: 'eval_run_id', nullable: true })
  evalRunId?: string | null;

  @Column('text', { name: 'change_summary', nullable: true })
  changeSummary?: string | null;

  @Column('text', { name: 'why', nullable: true })
  why?: string | null;

  @Column('text', { name: 'status', default: 'queued' })
  status!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
