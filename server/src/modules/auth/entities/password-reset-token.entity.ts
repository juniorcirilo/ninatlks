import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryColumn('uuid', { name: 'user_id' })
  userId!: string;

  @Column('text', { name: 'token', unique: true })
  token!: string;

  @Column('timestamptz', { name: 'expires_at' })
  expiresAt!: Date;
}
