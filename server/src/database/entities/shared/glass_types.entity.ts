import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('glass_types')
export class GlassTypes {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column('uuid', { name: 'account_id' })
  accountId!: string;

  @Column('text', { name: 'sku' })
  sku!: string;

  @Column('text', { name: 'name' })
  name!: string;

  @Column('text', { name: 'category' })
  category!: string;

  @Column('numeric', { name: 'thickness_mm' })
  thicknessMm!: number;

  @Column('text', { name: 'color', default: 'incolor' })
  color!: string;

  @Column('numeric', { name: 'price_per_m2' })
  pricePerM2!: number;

  @Column('numeric', { name: 'min_m2_per_piece', default: 0.5 })
  minM2PerPiece!: number;

  @Column('text', { name: 'nbr_reference', nullable: true })
  nbrReference?: string | null;

  @Column('text', { name: 'notes', nullable: true })
  notes?: string | null;

  @Column('boolean', { name: 'active', default: true })
  active!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
