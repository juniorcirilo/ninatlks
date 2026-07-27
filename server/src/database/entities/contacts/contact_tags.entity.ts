import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_tags')
export class ContactTags {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('text', { name: 'tag' })
  tag!: string;

  @Column('text', { name: 'color', nullable: true })
  color?: string | null;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('uuid', { name: 'created_by_id', nullable: true })
  createdById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
