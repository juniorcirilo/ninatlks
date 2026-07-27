import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('inboxes')
export class Inboxes {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'channel_id' })
  channelId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'greeting_message', nullable: true })
  greetingMessage?: string | null;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'channel_type', nullable: true })
  channelType?: string | null;

  @Column('boolean', { name: 'enable_auto_assignment', default: true })
  enableAutoAssignment!: boolean;

  @Column('boolean', { name: 'greeting_enabled', default: false })
  greetingEnabled!: boolean;

  @Column('boolean', { name: 'working_hours_enabled', default: false })
  workingHoursEnabled!: boolean;

  @Column('text', { name: 'out_of_office_message', nullable: true })
  outOfOfficeMessage?: string | null;

  @Column('text', {
    name: 'timezone',
    nullable: true,
    default: 'America/Sao_Paulo',
  })
  timezone?: string | null;

  @Column('boolean', { name: 'csat_survey_enabled', default: false })
  csatSurveyEnabled!: boolean;

  @Column('boolean', { name: 'allow_messages_after_resolved', default: true })
  allowMessagesAfterResolved!: boolean;

  @Column('jsonb', { name: 'auto_assignment_config', default: '{}' })
  autoAssignmentConfig!: Record<string, unknown>;

  @Column('uuid', { name: 'portal_id', nullable: true })
  portalId?: string | null;

  @Column('jsonb', { name: 'csat_config', default: '{}' })
  csatConfig!: Record<string, unknown>;
}
