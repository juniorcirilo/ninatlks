import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('profiles')
export class Profiles {
  @PrimaryColumn('uuid', { name: 'id' })
  id!: string;

  @Column('text', { name: 'email' })
  email!: string;

  @Column('text', { name: 'name', nullable: true })
  name?: string | null;

  @Column('text', { name: 'display_name', nullable: true })
  displayName?: string | null;

  @Column('text', { name: 'availability', default: 'offline' }) // Postgres enum "user_availability" — stored/read as text; DB still enforces the enum constraint.
  availability!: string;

  @Column('jsonb', { name: 'custom_attributes', default: '{}' })
  customAttributes!: Record<string, unknown>;

  @Column('jsonb', { name: 'ui_settings', default: '{}' })
  uiSettings!: Record<string, unknown>;

  @Column('timestamptz', { name: 'confirmed_at', nullable: true })
  confirmedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('boolean', { name: 'is_super_admin', default: false })
  isSuperAdmin!: boolean;

  @Column('boolean', {
    name: 'super_admin_onboarding_completed',
    default: true,
  })
  superAdminOnboardingCompleted!: boolean;

  @Column('text', { name: 'password_hash', nullable: true })
  passwordHash?: string | null;

  @Column('text', { name: 'password_algo', default: 'argon2' })
  passwordAlgo!: string;
}
