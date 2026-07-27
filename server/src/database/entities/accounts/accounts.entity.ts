import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('accounts')
export class Accounts {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'locale', default: 'pt-BR' })
  locale!: string;

  @Column('text', { name: 'domain', nullable: true })
  domain?: string | null;

  @Column('text', { name: 'support_email', nullable: true })
  supportEmail?: string | null;

  @Column('jsonb', { name: 'settings', default: '{}' })
  settings!: Record<string, unknown>;

  @Column('jsonb', { name: 'feature_flags', default: '{}' })
  featureFlags!: Record<string, unknown>;

  @Column('jsonb', { name: 'internal_attributes', default: '{}' })
  internalAttributes!: Record<string, unknown>;

  @Column('text', { name: 'status', default: 'active' }) // Postgres enum "account_status" — stored/read as text; DB still enforces the enum constraint.
  status!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('jsonb', { name: 'dialing_settings', default: '{}' })
  dialingSettings!: Record<string, unknown>;

  @Column('boolean', { name: 'is_primary', default: false })
  isPrimary!: boolean;
}
