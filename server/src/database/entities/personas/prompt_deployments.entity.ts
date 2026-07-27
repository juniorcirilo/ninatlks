import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('prompt_deployments')
export class PromptDeployments {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('bigint', { name: 'prompt_version_id' })
  promptVersionId!: string;

  @Column('uuid', { name: 'inbox_id', nullable: true })
  inboxId?: string | null;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('numeric', { name: 'traffic_share', default: 1.0 })
  trafficShare!: number;

  @Column('timestamptz', { name: 'started_at' })
  startedAt!: Date;

  @Column('timestamptz', { name: 'ended_at', nullable: true })
  endedAt?: Date | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
