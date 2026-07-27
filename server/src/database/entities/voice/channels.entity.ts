import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('channels')
export class Channels {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'channel_type' }) // Postgres enum "channel_type" — stored/read as text; DB still enforces the enum constraint.
  channelType!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('jsonb', { name: 'config', default: '{}' })
  config!: Record<string, unknown>;

  @Column('boolean', { name: 'enabled', default: true })
  enabled!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
