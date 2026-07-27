import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_facts')
export class ContactFacts {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('text', { name: 'key' })
  key!: string;

  @Column('text', { name: 'value', nullable: true })
  value?: string | null;

  @Column('numeric', { name: 'value_numeric', nullable: true })
  valueNumeric?: number | null;

  @Column('numeric', { name: 'confidence', default: 0.5 })
  confidence!: number;

  @Column('bigint', { name: 'source_node_id', nullable: true })
  sourceNodeId?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
