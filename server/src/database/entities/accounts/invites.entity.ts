import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('invites')
export class Invites {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'email' })
  email!: string;

  @Column('text', { name: 'role', default: 'agent' }) // Postgres enum "app_role" — stored/read as text; DB still enforces the enum constraint.
  role!: string;

  @Column('text', { name: 'token' })
  token!: string;

  @Column('uuid', { name: 'invited_by_user_id', nullable: true })
  invitedByUserId?: string | null;

  @Column('timestamptz', { name: 'accepted_at', nullable: true })
  acceptedAt?: Date | null;

  @Column('uuid', { name: 'accepted_by_user_id', nullable: true })
  acceptedByUserId?: string | null;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt!: Date;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
