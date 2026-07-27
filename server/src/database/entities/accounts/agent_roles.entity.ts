import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('agent_roles')
export class AgentRoles {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'persona_id' })
  personaId!: string;

  @Column('text', { name: 'kind' }) // Postgres enum "agent_role_kind" — stored/read as text; DB still enforces the enum constraint.
  kind!: string;

  @Column('text', { name: 'display_name' })
  displayName!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('text', { name: 'allowed_tools', array: true })
  allowedTools!: string[];

  @Column('uuid', { name: 'handoff_targets', array: true })
  handoffTargets!: string[];

  @Column('jsonb', { name: 'handoff_rules', default: '[]' })
  handoffRules!: Record<string, unknown>;

  @Column('integer', { name: 'daily_message_budget', default: 500 })
  dailyMessageBudget!: number;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
