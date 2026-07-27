import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('phone_numbers')
export class PhoneNumbers {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'e164' })
  e164!: string;

  @Column('text', { name: 'friendly_name', nullable: true })
  friendlyName?: string | null;

  @Column('text', { name: 'provider', default: 'twilio' })
  provider!: string;

  @Column('jsonb', { name: 'provider_config', default: '{}' })
  providerConfig!: Record<string, unknown>;

  @Column('uuid', { name: 'inbox_id', nullable: true })
  inboxId?: string | null;

  @Column('uuid', { name: 'pinned_persona_id', nullable: true })
  pinnedPersonaId?: string | null;

  @Column('text', { name: 'inbound_behavior', default: 'ai_answer' }) // Postgres enum "phone_inbound_behavior" — stored/read as text; DB still enforces the enum constraint.
  inboundBehavior!: string;

  @Column('boolean', { name: 'outbound_enabled', default: false })
  outboundEnabled!: boolean;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;

  @Column('text', { name: 'elevenlabs_phone_number_id', nullable: true })
  elevenlabsPhoneNumberId?: string | null;
}
