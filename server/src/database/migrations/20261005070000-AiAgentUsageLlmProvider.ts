import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * O Agente de IA deixou de depender do OpenCode CLI e passou a falar
 * diretamente com qualquer endpoint compatível com a API da OpenAI
 * (ver llm-bridge.service.ts). `ai_agent_usage.provider='opencode'` vira
 * 'llm' (mesmo significado: "via o motor configurado", em oposição a
 * 'legacy', o provedor antigo de fallback).
 */
export class AiAgentUsageLlmProvider20261005070000
  implements MigrationInterface
{
  name = 'AiAgentUsageLlmProvider20261005070000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_usage drop constraint if exists ai_agent_usage_provider_check;
    `);
    await queryRunner.query(`
      update public.ai_agent_usage set provider = 'llm' where provider = 'opencode';
    `);
    await queryRunner.query(`
      alter table public.ai_agent_usage
        alter column provider set default 'llm',
        add constraint ai_agent_usage_provider_check check (provider in ('llm', 'legacy'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      alter table public.ai_agent_usage drop constraint if exists ai_agent_usage_provider_check;
    `);
    await queryRunner.query(`
      update public.ai_agent_usage set provider = 'opencode' where provider = 'llm';
    `);
    await queryRunner.query(`
      alter table public.ai_agent_usage
        alter column provider set default 'opencode',
        add constraint ai_agent_usage_provider_check check (provider in ('opencode', 'legacy'));
    `);
  }
}
