import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Regenerar skill de um agente: a skill que o IA Agent gera a partir da
 * descrição do agente é ÚNICA por agente (origin='generated'). Clicar em
 * "Gerar com IA Agent" de novo ATUALIZA essa mesma linha em vez de criar uma
 * skill duplicada a cada clique. Skills criadas manualmente (origin='manual',
 * o padrão) nunca são tocadas por essa regeneração.
 */
export class AiAgentSkillOrigin20261005060000 implements MigrationInterface {
  name = 'AiAgentSkillOrigin20261005060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_skills
        add column if not exists origin text not null default 'manual'
          check (origin in ('manual', 'generated'));
    `);
    await queryRunner.query(`
      create unique index if not exists ai_agent_skills_generated_uq
        on public.ai_agent_skills(account_id, persona_id)
        where origin = 'generated' and persona_id is not null;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `drop index if exists public.ai_agent_skills_generated_uq;`,
    );
    await queryRunner.query(
      `alter table public.ai_agent_skills drop column if exists origin;`,
    );
  }
}
