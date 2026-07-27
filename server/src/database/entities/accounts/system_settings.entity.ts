import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('system_settings')
export class SystemSettings {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('boolean', { name: 'registration_enabled', default: true })
  registrationEnabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
