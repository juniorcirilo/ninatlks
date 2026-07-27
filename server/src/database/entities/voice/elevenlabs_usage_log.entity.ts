import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('elevenlabs_usage_log')
export class ElevenlabsUsageLog {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'persona_id', nullable: true })
  personaId?: string | null;

  @Column('text', { name: 'voice_id', nullable: true })
  voiceId?: string | null;

  @Column('integer', { name: 'character_count' })
  characterCount!: number;

  @Column('text', { name: 'model_id', nullable: true })
  modelId?: string | null;

  @Column('text', { name: 'purpose', nullable: true })
  purpose?: string | null;

  @Column('uuid', { name: 'voice_call_id', nullable: true })
  voiceCallId?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
