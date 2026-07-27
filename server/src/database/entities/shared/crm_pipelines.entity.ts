import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('crm_pipelines')
export class CrmPipelines {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'provider_pipeline_id' })
  providerPipelineId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('boolean', { name: 'active', default: true })
  active!: boolean;

  @Column('timestamptz', { name: 'last_synced_at', nullable: true })
  lastSyncedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
