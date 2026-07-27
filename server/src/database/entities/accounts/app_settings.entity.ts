import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('app_settings')
export class AppSettings {
  @PrimaryColumn('uuid', { name: 'id' })
  id!: string;

  @Column('text', { name: 'supabase_url', nullable: true })
  supabaseUrl?: string | null;

  @Column('text', { name: 'supabase_publishable_key', nullable: true })
  supabasePublishableKey?: string | null;

  @Column('jsonb', { name: 'secret_refs', default: '{}' })
  secretRefs!: Record<string, unknown>;

  @Column('jsonb', { name: 'metadata', default: '{}' })
  metadata!: Record<string, unknown>;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
