import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('calendar_blocks')
export class CalendarBlocks {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'user_id' })
  userId!: string;

  @Column('timestamptz', { name: 'starts_at' })
  startsAt!: Date;

  @Column('timestamptz', { name: 'ends_at' })
  endsAt!: Date;

  @Column('text', { name: 'reason', nullable: true })
  reason?: string | null;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
