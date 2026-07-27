import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('conversation_outcomes')
export class ConversationOutcomes {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('text', { name: 'outcome_type' })
  outcomeType!: string;

  @Column('numeric', { name: 'value', nullable: true })
  value?: number | null;

  @Column('text', { name: 'currency', nullable: true, default: 'BRL' })
  currency?: string | null;

  @Column('text', { name: 'source', default: 'manual' })
  source!: string;

  @Column('numeric', { name: 'confidence', default: 1.0 })
  confidence!: number;

  @Column('timestamptz', { name: 'observed_at' })
  observedAt!: Date;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
