import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('payments_ledger')
export class PaymentsLedger {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id', nullable: true })
  contactId?: string | null;

  @Column('text', { name: 'provider' })
  provider!: string;

  @Column('text', { name: 'provider_payment_id' })
  providerPaymentId!: string;

  @Column('integer', { name: 'amount_cents' })
  amountCents!: number;

  @Column('text', { name: 'currency', default: 'BRL' })
  currency!: string;

  @Column('text', { name: 'status' })
  status!: string;

  @Column('timestamptz', { name: 'due_at', nullable: true })
  dueAt?: Date | null;

  @Column('timestamptz', { name: 'paid_at', nullable: true })
  paidAt?: Date | null;

  @Column('integer', { name: 'days_overdue', nullable: true })
  daysOverdue?: number | null;

  @Column('text', { name: 'customer_email', nullable: true })
  customerEmail?: string | null;

  @Column('text', { name: 'customer_phone', nullable: true })
  customerPhone?: string | null;

  @Column('text', { name: 'description', nullable: true })
  description?: string | null;

  @Column('jsonb', { name: 'payload', default: '{}' })
  payload!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
