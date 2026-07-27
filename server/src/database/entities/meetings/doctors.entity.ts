import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('doctors')
export class Doctors {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'specialty', nullable: true })
  specialty?: string | null;

  @Column('text', { name: 'modalities', array: true })
  modalities!: string[];

  @Column('integer', { name: 'default_duration_minutes', default: 30 })
  defaultDurationMinutes!: number;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('boolean', { name: 'active', default: true })
  active!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
