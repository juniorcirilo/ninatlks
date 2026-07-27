import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('companies')
export class Companies {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'website', nullable: true })
  website?: string | null;

  @Column('text', { name: 'industry', nullable: true })
  industry?: string | null;

  @Column('text', { name: 'location', nullable: true })
  location?: string | null;

  @Column('jsonb', { name: 'custom_attributes', default: '{}' })
  customAttributes!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'domain', nullable: true })
  domain?: string | null;

  @Column('text', { name: 'size', nullable: true })
  size?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;
}
