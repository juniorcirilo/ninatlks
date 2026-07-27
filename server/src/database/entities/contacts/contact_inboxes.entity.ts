import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('contact_inboxes')
export class ContactInboxes {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('uuid', { name: 'inbox_id' })
  inboxId!: string;

  @Column('text', { name: 'source_id', nullable: true })
  sourceId?: string | null;

  @Column('boolean', { name: 'hmac_verified', default: false })
  hmacVerified!: boolean;

  @Column('text', { name: 'pubsub_token', nullable: true })
  pubsubToken?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
