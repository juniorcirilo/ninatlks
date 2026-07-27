import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260519204518_e7d8e5ae-3a29-454d-9c05-6f19a27972eb.sql.
export class Migration20260519204518 implements MigrationInterface {
  name = 'Migration20260519204518';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE public.agent_personas SET name = 'Nina', elevenlabs_agent_id = 'agent_5601ks0ttg60feyr69jyt231jexa', updated_at = now() WHERE id = '138066a9-ed08-4d4d-a37b-a598e2de6bfd';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260519204518 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
