import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('outcome_attributions')
export class OutcomeAttributions {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('bigint', { name: 'outcome_id' })
  outcomeId!: string;

  @Column('uuid', { name: 'message_id', nullable: true })
  messageId?: string | null;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('bigint', { name: 'prompt_version_id', nullable: true })
  promptVersionId?: string | null;

  @Column('numeric', { name: 'weight', default: 1.0 })
  weight!: number;

  @Column('text', { name: 'reason', nullable: true })
  reason?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
