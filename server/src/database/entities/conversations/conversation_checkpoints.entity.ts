import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('conversation_checkpoints')
export class ConversationCheckpoints {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'message_id', nullable: true })
  messageId?: string | null;

  @Column('jsonb', { name: 'state', default: '{}' })
  state!: Record<string, unknown>;

  @Column('bigint', { name: 'branched_from_id', nullable: true })
  branchedFromId?: string | null;

  @Column('text', { name: 'branch_note', nullable: true })
  branchNote?: string | null;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
