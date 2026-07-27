import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('promise_followups')
export class PromiseFollowups {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('uuid', { name: 'source_call_id', nullable: true })
  sourceCallId?: string | null;

  @Column('uuid', { name: 'source_campaign_id', nullable: true })
  sourceCampaignId?: string | null;

  @Column('numeric', { name: 'promised_amount', nullable: true })
  promisedAmount?: number | null;

  @Column('timestamptz', { name: 'promised_at' })
  promisedAt!: Date;

  @Column('date', { name: 'promised_due_date' })
  promisedDueDate!: Date;

  @Column('timestamptz', { name: 'followup_at' })
  followupAt!: Date;

  @Column('text', { name: 'status', default: 'pending' })
  status!: string;

  @Column('uuid', { name: 'followup_campaign_id', nullable: true })
  followupCampaignId?: string | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
