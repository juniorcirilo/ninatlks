import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('live_takeovers')
export class LiveTakeovers {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('bigint', { name: 'session_id' })
  sessionId!: string;

  @Column('text', { name: 'from_type' })
  fromType!: string;

  @Column('uuid', { name: 'from_id', nullable: true })
  fromId?: string | null;

  @Column('text', { name: 'to_type' })
  toType!: string;

  @Column('uuid', { name: 'to_id', nullable: true })
  toId?: string | null;

  @Column('text', { name: 'reason', default: 'manual' })
  reason!: string;

  @Column('boolean', { name: 'visible_to_customer', default: false })
  visibleToCustomer!: boolean;

  @Column('uuid', { name: 'at_message_id', nullable: true })
  atMessageId?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
