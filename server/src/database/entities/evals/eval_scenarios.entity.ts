import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('eval_scenarios')
export class EvalScenarios {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('jsonb', { name: 'customer_profile', default: '{}' })
  customerProfile!: Record<string, unknown>;

  @Column('text', { name: 'goal' })
  goal!: string;

  @Column('jsonb', { name: 'hidden_traits', default: '[]' })
  hiddenTraits!: Record<string, unknown>;

  @Column('text', { name: 'success_criteria', default: '' })
  successCriteria!: string;

  @Column('numeric', { name: 'difficulty', default: 0.5 })
  difficulty!: number;

  @Column('text', { name: 'source', default: 'manual' })
  source!: string;

  @Column('uuid', { name: 'source_conversation_id', nullable: true })
  sourceConversationId?: string | null;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
