import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('contact_list_members')
export class ContactListMembers {
  @PrimaryColumn('uuid', { name: 'list_id' })
  listId!: string;

  @PrimaryColumn('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('timestamptz', { name: 'added_at' })
  addedAt!: Date;
}
