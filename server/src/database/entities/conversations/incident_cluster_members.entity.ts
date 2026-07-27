import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('incident_cluster_members')
export class IncidentClusterMembers {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('bigint', { name: 'cluster_id' })
  clusterId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('numeric', { name: 'match_score', default: 0.0 })
  matchScore!: number;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
