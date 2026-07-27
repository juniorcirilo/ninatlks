import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('call_attempts_log')
export class CallAttemptsLog {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('text', { name: 'phone_number' })
  phoneNumber!: string;

  @Column('uuid', { name: 'campaign_id', nullable: true })
  campaignId?: string | null;

  @Column('uuid', { name: 'voice_call_id', nullable: true })
  voiceCallId?: string | null;

  @Column('timestamptz', { name: 'attempt_at' })
  attemptAt!: Date;

  @Column('text', { name: 'outcome', nullable: true })
  outcome?: string | null;
}
