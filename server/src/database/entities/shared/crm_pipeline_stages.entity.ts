import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_pipeline_stages')
export class CrmPipelineStages {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'pipeline_id' })
  pipelineId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'provider_stage_id' })
  providerStageId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('integer', { name: 'order_index', default: 0 })
  orderIndex!: number;

  @Column('boolean', { name: 'is_won', default: false })
  isWon!: boolean;

  @Column('boolean', { name: 'is_lost', default: false })
  isLost!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
