import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('customer_memory_edges')
export class CustomerMemoryEdges {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('bigint', { name: 'from_node_id', nullable: true })
  fromNodeId?: string | null;

  @Column('bigint', { name: 'to_node_id', nullable: true })
  toNodeId?: string | null;

  @Column('uuid', { name: 'from_contact_id', nullable: true })
  fromContactId?: string | null;

  @Column('uuid', { name: 'to_contact_id', nullable: true })
  toContactId?: string | null;

  @Column('text', { name: 'relation' })
  relation!: string;

  @Column('numeric', { name: 'weight', default: 1.0 })
  weight!: number;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
