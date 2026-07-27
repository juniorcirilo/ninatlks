import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lead_stages')
export class LeadStages {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'pipeline_id' })
  pipelineId!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('smallint', { name: 'position' })
  position!: number;

  @Column('text', { name: 'color', default: 'slate' })
  color!: string;

  @Column('boolean', { name: 'is_won', default: false })
  isWon!: boolean;

  @Column('boolean', { name: 'is_lost', default: false })
  isLost!: boolean;

  @Column('smallint', { name: 'sla_hours', nullable: true })
  slaHours?: number | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
