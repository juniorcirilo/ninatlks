import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('campaign_runs')
export class CampaignRuns {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'inbox_id' })
  inboxId!: string;

  @Column('uuid', { name: 'persona_id' })
  personaId!: string;

  @Column('uuid', { name: 'triggered_by_id', nullable: true })
  triggeredById?: string | null;

  @Column('text', { name: 'message_template', nullable: true })
  messageTemplate?: string | null;

  @Column('boolean', { name: 'used_ai', default: false })
  usedAi!: boolean;

  @Column('integer', { name: 'contact_count', default: 0 })
  contactCount!: number;

  @Column('integer', { name: 'sent_count', default: 0 })
  sentCount!: number;

  @Column('integer', { name: 'skipped_count', default: 0 })
  skippedCount!: number;

  @Column('integer', { name: 'error_count', default: 0 })
  errorCount!: number;

  @Column('jsonb', { name: 'errors', default: '[]' })
  errors!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  finishedAt?: Date | null;
}
