import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('call_outcomes_catalog')
export class CallOutcomesCatalog {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id', nullable: true })
  accountId?: string | null;

  @Column('text', { name: 'campaign_kind' })
  campaignKind!: string;

  @Column('text', { name: 'code' })
  code!: string;

  @Column('text', { name: 'label' })
  label!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('smallint', { name: 'score', default: 0 })
  score!: number;

  @Column('boolean', { name: 'terminal', default: false })
  terminal!: boolean;

  @Column('text', { name: 'color', nullable: true })
  color?: string | null;

  @Column('smallint', { name: 'position', default: 0 })
  position!: number;

  @Column('boolean', { name: 'is_default', default: false })
  isDefault!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
