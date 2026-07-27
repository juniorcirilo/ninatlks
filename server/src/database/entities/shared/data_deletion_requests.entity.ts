import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('data_deletion_requests')
export class DataDeletionRequests {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('text', { name: 'confirmation_id' })
  confirmationId!: string;

  @Column('text', { name: 'source' })
  source!: string;

  @Column('text', { name: 'email', nullable: true })
  email?: string | null;

  @Column('text', { name: 'external_identifier', nullable: true })
  externalIdentifier?: string | null;

  @Column('text', { name: 'meta_user_id', nullable: true })
  metaUserId?: string | null;

  @Column('text', { name: 'reason', nullable: true })
  reason?: string | null;

  @Column('jsonb', { name: 'raw_payload', nullable: true })
  rawPayload?: Record<string, unknown> | null;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('timestamptz', { name: 'processed_at', nullable: true })
  processedAt?: Date | null;

  @Column('uuid', { name: 'processed_by_user_id', nullable: true })
  processedByUserId?: string | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('inet', { name: 'ip_address', nullable: true })
  ipAddress?: string | null;

  @Column('text', { name: 'user_agent', nullable: true })
  userAgent?: string | null;
}
