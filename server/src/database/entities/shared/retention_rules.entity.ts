import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('retention_rules')
export class RetentionRules {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('integer', { name: 'inactive_days', default: 60 })
  inactiveDays!: number;

  @Column('uuid', { name: 'required_stage_id', nullable: true })
  requiredStageId?: string | null;

  @Column('uuid', { name: 'required_tag_ids', array: true, default: '{}' })
  requiredTagIds!: string[];

  @Column('uuid', { name: 'target_campaign_id', nullable: true })
  targetCampaignId?: string | null;

  @Column('integer', { name: 'max_enrolls_per_run', default: 50 })
  maxEnrollsPerRun!: number;

  @Column('timestamptz', { name: 'last_run_at', nullable: true })
  lastRunAt?: Date | null;

  @Column('integer', { name: 'last_enrolled_count', default: 0 })
  lastEnrolledCount!: number;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
