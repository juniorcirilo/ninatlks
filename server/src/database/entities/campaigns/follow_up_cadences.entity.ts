import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('follow_up_cadences')
export class FollowUpCadences {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('uuid', { name: 'trigger_stage_id', nullable: true })
  triggerStageId?: string | null;

  @Column('text', { name: 'trigger_event' })
  triggerEvent!: string;

  @Column('jsonb', { name: 'steps', default: '[]' })
  steps!: Record<string, unknown>;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
