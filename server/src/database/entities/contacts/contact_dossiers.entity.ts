import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('contact_dossiers')
export class ContactDossiers {
  @PrimaryColumn('uuid', { name: 'contact_id' })
  contactId!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'briefing', default: '' })
  briefing!: string;

  @Column('jsonb', { name: 'highlights', default: '[]' })
  highlights!: Record<string, unknown>;

  @Column('text', { name: 'embedding', nullable: true }) // pgvector "vector(1536)" — no native TypeORM type; DB column is unaffected by this.
  embedding?: number[] | null;

  @Column('integer', { name: 'node_count', default: 0 })
  nodeCount!: number;

  @Column('timestamptz', { name: 'generated_at' })
  generatedAt!: Date;

  @Column('timestamptz', { name: 'stale_after' })
  staleAfter!: Date;
}
