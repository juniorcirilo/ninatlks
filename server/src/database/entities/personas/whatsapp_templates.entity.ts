import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('whatsapp_templates')
export class WhatsappTemplates {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'waba_id' })
  wabaId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'language' })
  language!: string;

  @Column('text', { name: 'category' })
  category!: string;

  @Column('jsonb', { name: 'components', default: '[]' })
  components!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'draft' })
  status!: string;

  @Column('text', { name: 'rejected_reason', nullable: true })
  rejectedReason?: string | null;

  @Column('text', { name: 'quality_score', nullable: true })
  qualityScore?: string | null;

  @Column('text', { name: 'meta_template_id', nullable: true })
  metaTemplateId?: string | null;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
