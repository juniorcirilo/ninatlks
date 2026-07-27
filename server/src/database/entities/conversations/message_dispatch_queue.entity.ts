import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('message_dispatch_queue')
export class MessageDispatchQueue {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'message_id' })
  messageId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('text', { name: 'channel_type' }) // Postgres enum "channel_type" — stored/read as text; DB still enforces the enum constraint.
  channelType!: string;

  @Column('integer', { name: 'attempts', default: 0 })
  attempts!: number;

  @Column('integer', { name: 'max_attempts', default: 5 })
  maxAttempts!: number;

  @Column('timestamptz', { name: 'next_attempt_at' })
  nextAttemptAt!: Date;

  @Column('text', { name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
