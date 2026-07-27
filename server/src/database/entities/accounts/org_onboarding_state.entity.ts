import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('org_onboarding_state')
export class OrgOnboardingState {
  @PrimaryColumn('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('timestamptz', { name: 'started_at' })
  startedAt!: Date;

  @Column('timestamptz', { name: 'completed_at', nullable: true })
  completedAt?: Date | null;

  @Column('text', { name: 'current_step', default: 'welcome' })
  currentStep!: string;

  @Column('jsonb', { name: 'completed_steps', default: '[]' })
  completedSteps!: Record<string, unknown>;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('jsonb', { name: 'health_check_results', default: '{}' })
  healthCheckResults!: Record<string, unknown>;

  @Column('timestamptz', { name: 'health_check_at', nullable: true })
  healthCheckAt?: Date | null;

  @Column('timestamptz', { name: 'dismissed_at', nullable: true })
  dismissedAt?: Date | null;
}
