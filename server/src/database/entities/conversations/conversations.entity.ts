import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('conversations')
export class Conversations {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'inbox_id' })
  inboxId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('smallint', { name: 'status', default: 0 })
  status!: number;

  @Column('uuid', { name: 'assignee_id', nullable: true })
  assigneeId?: string | null;

  @Column('integer', { name: 'display_id', default: 0 })
  displayId!: number;

  @Column('timestamptz', { name: 'contact_last_seen_at', nullable: true })
  contactLastSeenAt?: Date | null;

  @Column('timestamptz', { name: 'agent_last_seen_at', nullable: true })
  agentLastSeenAt?: Date | null;

  @Column('jsonb', { name: 'additional_attributes', default: '{}' })
  additionalAttributes!: Record<string, unknown>;

  @Column('text', { name: 'uuid', nullable: true })
  uuid?: string | null;

  @Column('text', { name: 'identifier', nullable: true })
  identifier?: string | null;

  @Column('timestamptz', { name: 'last_activity_at' })
  lastActivityAt!: Date;

  @Column('uuid', { name: 'team_id', nullable: true })
  teamId?: string | null;

  @Column('uuid', { name: 'campaign_id', nullable: true })
  campaignId?: string | null;

  @Column('timestamptz', { name: 'snoozed_until', nullable: true })
  snoozedUntil?: Date | null;

  @Column('jsonb', { name: 'custom_attributes', default: '{}' })
  customAttributes!: Record<string, unknown>;

  @Column('timestamptz', { name: 'first_reply_created_at', nullable: true })
  firstReplyCreatedAt?: Date | null;

  @Column('smallint', { name: 'priority', nullable: true, default: 0 })
  priority?: number | null;

  @Column('uuid', { name: 'sla_policy_id', nullable: true })
  slaPolicyId?: string | null;

  @Column('timestamptz', { name: 'waiting_since', nullable: true })
  waitingSince?: Date | null;

  @Column('text', { name: 'cached_label_list', nullable: true })
  cachedLabelList?: string | null;

  @Column('uuid', { name: 'assignee_agent_bot_id', nullable: true })
  assigneeAgentBotId?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('timestamptz', { name: 'last_customer_msg_at', nullable: true })
  lastCustomerMsgAt?: Date | null;

  @Column('timestamptz', { name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @Column('boolean', { name: 'ai_autopilot_enabled', default: true })
  aiAutopilotEnabled!: boolean;
}
