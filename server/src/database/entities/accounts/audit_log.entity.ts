import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'actor_id', nullable: true })
  actorId?: string | null;

  @Column('text', { name: 'entity_type' })
  entityType!: string;

  @Column('text', { name: 'entity_id', nullable: true })
  entityId?: string | null;

  @Column('text', { name: 'action' })
  action!: string;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('uuid', { name: 'user_id', nullable: true })
  userId?: string | null;

  @Column('text', { name: 'resource_type', nullable: true })
  resourceType?: string | null;

  @Column('text', { name: 'resource_id', nullable: true })
  resourceId?: string | null;

  @Column('text', { name: 'ip_address', nullable: true })
  ipAddress?: string | null;

  @Column('text', { name: 'user_agent', nullable: true })
  userAgent?: string | null;
}
