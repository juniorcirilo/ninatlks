import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('webhook_deliveries')
export class WebhookDeliveries {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'endpoint' })
  endpoint!: string;

  @Column('text', { name: 'direction', default: 'inbound' })
  direction!: string;

  @Column('integer', { name: 'http_status', nullable: true })
  httpStatus?: number | null;

  @Column('integer', { name: 'duration_ms', nullable: true })
  durationMs?: number | null;

  @Column('text', { name: 'source_ip', nullable: true })
  sourceIp?: string | null;

  @Column('boolean', { name: 'signature_valid', nullable: true })
  signatureValid?: boolean | null;

  @Column('text', { name: 'payload_preview', nullable: true })
  payloadPreview?: string | null;

  @Column('text', { name: 'error', nullable: true })
  error?: string | null;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
