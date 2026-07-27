import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sessions')
export class Sessions {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('text', { name: 'token_hash' })
  tokenHash!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('uuid', { name: 'account_id', nullable: true })
  accountId?: string | null;

  @Column('text', { name: 'user_agent', nullable: true })
  userAgent?: string | null;

  @Column('inet', { name: 'ip', nullable: true })
  ip?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'last_seen_at' })
  lastSeenAt!: Date;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt!: Date;

  @Column('timestamptz', { name: 'revoked_at', nullable: true })
  revokedAt?: Date | null;
}
