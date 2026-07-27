import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('doctor_availability')
export class DoctorAvailability {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('uuid', { name: 'doctor_id' })
  doctorId!: string;

  @Column('smallint', { name: 'weekday' })
  weekday!: number;

  @Column('text', { name: 'start_time' })
  startTime!: string;

  @Column('text', { name: 'end_time' })
  endTime!: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;
}
