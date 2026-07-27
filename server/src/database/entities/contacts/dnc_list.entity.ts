import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dnc_list')
export class DncList {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'phone_number' })
  phoneNumber!: string;

  @Column('text', { name: 'reason', nullable: true })
  reason?: string | null;

  @Column('uuid', { name: 'added_by', nullable: true })
  addedBy?: string | null;

  @Column('text', { name: 'source', nullable: true })
  source?: string | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'registered_at' })
  registeredAt!: Date;

  @Column('uuid', { name: 'registered_by', nullable: true })
  registeredBy?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('text', { name: 'phone_e164', nullable: true })
  phoneE164?: string | null;
}
