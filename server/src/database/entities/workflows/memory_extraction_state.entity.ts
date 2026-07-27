import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('memory_extraction_state')
export class MemoryExtractionState {
  @PrimaryColumn('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('uuid', { name: 'last_extracted_message_id', nullable: true })
  lastExtractedMessageId?: string | null;

  @Column('timestamptz', { name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column('text', { name: 'status', default: 'idle' })
  status!: string;

  @Column('integer', { name: 'error_count', default: 0 })
  errorCount!: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
