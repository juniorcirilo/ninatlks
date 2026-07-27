import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sms_opt_outs')
export class SmsOptOuts {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'phone_number' })
  phoneNumber!: string;

  @Column('text', { name: 'reason', nullable: true })
  reason?: string | null;

  @Column('timestamptz', { name: 'opted_out_at' })
  optedOutAt!: Date;

  @Column('timestamptz', { name: 'opted_back_in_at', nullable: true })
  optedBackInAt?: Date | null;
}
