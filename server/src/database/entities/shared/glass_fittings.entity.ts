import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('glass_fittings')
export class GlassFittings {
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

  @Column('text', { name: 'unit', default: 'un' })
  unit!: string;

  @Column('numeric', { name: 'price' })
  price!: number;

  @Column('numeric', { name: 'compatible_thickness_mm', array: true })
  compatibleThicknessMm!: number[];

  @Column('text', { name: 'finish', nullable: true })
  finish?: string | null;

  @Column('boolean', { name: 'active', default: true })
  active!: boolean;

  @Column('timestamptz', { name: 'created_at' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at' })
  updatedAt!: Date;
}
