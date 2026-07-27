import { MigrationInterface, QueryRunner } from 'typeorm';

// Ported from supabase/migrations/20260515130514_ec925945-f3b0-4cea-9aa0-daddd1237fe9.sql.
export class Migration20260515130514 implements MigrationInterface {
  name = 'Migration20260515130514';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
UPDATE auth.users SET encrypted_password = crypt('admin@123', gen_salt('bf')), updated_at = now() WHERE email = 'junior@ubva.com.br';
`);
  }

  public down(): Promise<void> {
    throw new Error(
      'Migration20260515130514 has no down migration (ported historical schema) — restore from backup instead.',
    );
  }
}
