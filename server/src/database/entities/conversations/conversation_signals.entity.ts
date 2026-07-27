import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('conversation_signals')
export class ConversationSignals {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'message_id', nullable: true })
  messageId?: string | null;

  @Column('text', { name: 'kind' })
  kind!: string;

  @Column('numeric', { name: 'severity', default: 0.5 })
  severity!: number;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('text', { name: 'action', nullable: true })
  action?: string | null;

  @Column('timestamptz', { name: 'detected_at' })
  detectedAt!: Date;
}
