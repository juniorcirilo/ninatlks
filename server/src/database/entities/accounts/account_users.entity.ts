import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_users')
export class AccountUsers {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('text', { name: 'availability', default: 'offline' }) // Postgres enum "user_availability" — stored/read as text; DB still enforces the enum constraint.
  availability!: string;

  @Column('boolean', { name: 'auto_offline', default: true })
  autoOffline!: boolean;

  @Column('timestamptz', { name: 'active_at', nullable: true })
  activeAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
