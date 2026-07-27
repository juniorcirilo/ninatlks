import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_lists')
export class ContactLists {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('text', { name: 'campaign_kind', nullable: true })
  campaignKind?: string | null;

  @Column('jsonb', { name: 'filters', default: '{}' })
  filters!: Record<string, unknown>;

  @Column('boolean', { name: 'is_dynamic', default: false })
  isDynamic!: boolean;

  @Column('integer', { name: 'member_count', default: 0 })
  memberCount!: number;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
