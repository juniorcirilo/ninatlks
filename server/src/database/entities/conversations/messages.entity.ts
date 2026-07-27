import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('messages')
export class Messages {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('text', { name: 'content', nullable: true })
  content?: string | null;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'inbox_id' })
  inboxId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('smallint', { name: 'message_type', default: 0 })
  messageType!: number;

  @Column('boolean', { name: 'private', default: false })
  private!: boolean;

  @Column('text', { name: 'source_id', nullable: true })
  sourceId?: string | null;

  @Column('smallint', { name: 'content_type', default: 0 })
  contentType!: number;

  @Column('jsonb', { name: 'content_attributes', default: '{}' })
  contentAttributes!: Record<string, unknown>;

  @Column('text', { name: 'sender_type', nullable: true })
  senderType?: string | null;

  @Column('uuid', { name: 'sender_id', nullable: true })
  senderId?: string | null;

  @Column('jsonb', { name: 'external_source_ids', default: '{}' })
  externalSourceIds!: Record<string, unknown>;

  @Column('jsonb', { name: 'additional_attributes', default: '{}' })
  additionalAttributes!: Record<string, unknown>;

  @Column('text', { name: 'processed_message_content', nullable: true })
  processedMessageContent?: string | null;

  @Column('jsonb', { name: 'sentiment', nullable: true })
  sentiment?: Record<string, unknown> | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
