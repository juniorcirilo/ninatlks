import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agent_persona_deployments')
export class AgentPersonaDeployments {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'persona_id' })
  personaId!: string;

  @Column('uuid', { name: 'inbox_id' })
  inboxId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('text', { name: 'mode', default: 'always' })
  mode!: string;

  @Column('jsonb', { name: 'schedule', default: '{}' })
  schedule!: Record<string, unknown>;

  @Column('text', { name: 'autonomy', default: 'suggest' })
  autonomy!: string;

  @Column('numeric', { name: 'confidence_threshold', default: 0.4 })
  confidenceThreshold!: number;

  @Column('integer', { name: 'daily_message_budget', default: 100 })
  dailyMessageBudget!: number;

  @Column('integer', { name: 'messages_sent_today', default: 0 })
  messagesSentToday!: number;

  @Column('timestamptz', { name: 'last_reset_at' })
  lastResetAt!: Date;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
