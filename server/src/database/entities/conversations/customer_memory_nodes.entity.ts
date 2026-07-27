import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customer_memory_nodes')
export class CustomerMemoryNodes {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('text', { name: 'kind' })
  kind!: string;

  @Column('text', { name: 'summary' })
  summary!: string;

  @Column('text', { name: 'content', nullable: true })
  content?: string | null;

  @Column('text', { name: 'embedding', nullable: true }) // pgvector "vector(1536)" — no native TypeORM type; DB column is unaffected by this.
  embedding?: number[] | null;

  @Column('numeric', { name: 'confidence', default: 0.5 })
  confidence!: number;

  @Column('numeric', { name: 'importance', default: 0.5 })
  importance!: number;

  @Column('uuid', { name: 'source_message_id', nullable: true })
  sourceMessageId?: string | null;

  @Column('uuid', { name: 'source_conversation_id', nullable: true })
  sourceConversationId?: string | null;

  @Column('timestamptz', { name: 'expires_at', nullable: true })
  expiresAt?: Date | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
