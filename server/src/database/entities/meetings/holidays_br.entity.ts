import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('holidays_br')
export class HolidaysBr {
  @PrimaryColumn('date', { name: 'date' })
  date!: Date;

  @Column('text', { name: 'name' })
  name!: string;
}
