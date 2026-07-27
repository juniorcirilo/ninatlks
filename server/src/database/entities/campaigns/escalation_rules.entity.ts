import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('escalation_rules')
export class EscalationRules {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'scope', default: 'account' })
  scope!: string;

  @Column('uuid', { name: 'scope_ref', nullable: true })
  scopeRef?: string | null;

  @Column('integer', { name: 'priority', default: 100 })
  priority!: number;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('text', { name: 'trigger_type' })
  triggerType!: string;

  @Column('jsonb', { name: 'trigger_config', default: '{}' })
  triggerConfig!: Record<string, unknown>;

  @Column('text', { name: 'action' })
  action!: string;

  @Column('text', { name: 'action_target', nullable: true })
  actionTarget?: string | null;

  @Column('text', { name: 'label', nullable: true })
  label?: string | null;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
