import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('playbooks')
export class Playbooks {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id', nullable: true })
  accountId?: string | null;

  @Column('text', { name: 'slug' })
  slug!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('text', { name: 'use_case' })
  useCase!: string;

  @Column('text', { name: 'script_mode', default: 'hybrid' })
  scriptMode!: string;

  @Column('text', { name: 'opening_script', nullable: true })
  openingScript?: string | null;

  @Column('text', { name: 'system_prompt', nullable: true })
  systemPrompt?: string | null;

  @Column('text', { name: 'voice_id', nullable: true })
  voiceId?: string | null;

  @Column('jsonb', { name: 'voice_settings', nullable: true, default: '{}' })
  voiceSettings?: Record<string, unknown> | null;

  @Column('jsonb', { name: 'allowed_hours_local', nullable: true })
  allowedHoursLocal?: Record<string, unknown> | null;

  @Column('integer', {
    name: 'max_attempts_per_day',
    nullable: true,
    default: 2,
  })
  maxAttemptsPerDay?: number | null;

  @Column('integer', {
    name: 'min_minutes_between_attempts',
    nullable: true,
    default: 120,
  })
  minMinutesBetweenAttempts?: number | null;

  @Column('boolean', {
    name: 'disclaimer_enabled',
    nullable: true,
    default: true,
  })
  disclaimerEnabled?: boolean | null;

  @Column('jsonb', { name: 'escalation_rules', nullable: true, default: '[]' })
  escalationRules?: Record<string, unknown> | null;

  @Column('jsonb', {
    name: 'required_variables',
    nullable: true,
    default: '[]',
  })
  requiredVariables?: Record<string, unknown> | null;

  @Column('boolean', { name: 'is_system', default: false })
  isSystem!: boolean;

  @Column('text', { name: 'icon', nullable: true })
  icon?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
