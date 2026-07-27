import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('live_sessions')
export class LiveSessions {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'conversation_id' })
  conversationId!: string;

  @Column('text', { name: 'current_speaker_type', default: 'ai' })
  currentSpeakerType!: string;

  @Column('uuid', { name: 'current_speaker_id', nullable: true })
  currentSpeakerId?: string | null;

  @Column('uuid', { name: 'pinned_persona_id', nullable: true })
  pinnedPersonaId?: string | null;

  @Column('jsonb', { name: 'participants', default: '[]' })
  participants!: Record<string, unknown>;

  @Column('jsonb', { name: 'live_state', default: '{}' })
  liveState!: Record<string, unknown>;

  @Column('text', { name: 'rtc_channel', nullable: true })
  rtcChannel?: string | null;

  @Column('timestamptz', { name: 'started_at' })
  startedAt!: Date;

  @Column('timestamptz', { name: 'ended_at', nullable: true })
  endedAt?: Date | null;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
