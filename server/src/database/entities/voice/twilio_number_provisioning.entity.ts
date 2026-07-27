import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('twilio_number_provisioning')
export class TwilioNumberProvisioning {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'phone_number_id', nullable: true })
  phoneNumberId?: string | null;

  @Column('text', { name: 'e164' })
  e164!: string;

  @Column('text', { name: 'action' })
  action!: string;

  @Column('jsonb', { name: 'request', default: '{}' })
  request!: Record<string, unknown>;

  @Column('jsonb', { name: 'response', default: '{}' })
  response!: Record<string, unknown>;

  @Column('integer', { name: 'http_status', nullable: true })
  httpStatus?: number | null;

  @Column('uuid', { name: 'triggered_by_id', nullable: true })
  triggeredById?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
