import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_roles')
export class UserRoles {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('text', { name: 'role' }) // Postgres enum "app_role" — stored/read as text; DB still enforces the enum constraint.
  role!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
