import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('csat_surveys')
export class CsatSurveys {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('integer', { name: 'rating', nullable: true })
  rating?: number | null;

  @Column('text', { name: 'feedback', nullable: true })
  feedback?: string | null;

  @Column('text', { name: 'handler_type', nullable: true })
  handlerType?: string | null;

  @Column('uuid', { name: 'handler_id', nullable: true })
  handlerId?: string | null;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('timestamptz', { name: 'sent_at' })
  sentAt!: Date;

  @Column('timestamptz', { name: 'answered_at', nullable: true })
  answeredAt?: Date | null;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt!: Date;
}
