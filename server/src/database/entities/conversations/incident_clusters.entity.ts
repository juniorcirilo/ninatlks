import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('incident_clusters')
export class IncidentClusters {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'title' })
  title!: string;

  @Column('text', { name: 'summary', default: '' })
  summary!: string;

  @Column('integer', { name: 'contact_count', default: 0 })
  contactCount!: number;

  @Column('integer', { name: 'conversation_count', default: 0 })
  conversationCount!: number;

  @Column('text', { name: 'status', default: 'detected' })
  status!: string;

  @Column('text', { name: 'severity', default: 'low' })
  severity!: string;

  @Column('timestamptz', { name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column('timestamptz', { name: 'last_seen_at' })
  lastSeenAt!: Date;

  @Column('jsonb', { name: 'tags', default: '[]' })
  tags!: Record<string, unknown>;

  @Column('uuid', { name: 'acknowledged_by_id', nullable: true })
  acknowledgedById?: string | null;

  @Column('timestamptz', { name: 'acknowledged_at', nullable: true })
  acknowledgedAt?: Date | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'embedding', nullable: true }) // pgvector "vector(1536)" — no native TypeORM type; DB column is unaffected by this.
  embedding?: number[] | null;

  @Column('integer', { name: 'member_count', nullable: true, default: 0 })
  memberCount?: number | null;
}
