import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `llm_model` já aceita qualquer string (é como "custom-llm" já funciona sem
 * migration nenhuma na coluna existente) — o que falta é onde guardar a URL e
 * o model_id do servidor próprio quando o agente quer um diferente do padrão
 * da conta. Por agente, não por conta: "customizável para cada assunto" era
 * o pedido — um agente de cobrança pode apontar para um modelo, um de SDR
 * para outro, ambos no mesmo LM Studio ou em servidores diferentes.
 *
 * NULL nos dois = usa o padrão da conta (vault, provider 'custom-llm',
 * key_name 'api_url'/'model_id'/'api_key' — mesmo padrão de dois-a-três
 * campos que n8n e twilio já usam). Não duplicamos a API key aqui: ela mora
 * só no vault, nunca em texto claro numa coluna de tabela comum.
 */
export class PersonaCustomLlm20260731140000 implements MigrationInterface {
  name = 'PersonaCustomLlm20260731140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.agent_personas
  add column if not exists llm_custom_url text,
  add column if not exists llm_custom_model_id text;
`);
    await queryRunner.query(`
comment on column public.agent_personas.llm_custom_url is
  'URL do servidor LLM compatível com OpenAI (ex.: LM Studio) para este agente. NULL = usa o padrão da conta (Configurações → Geral).';
`);
    await queryRunner.query(`
comment on column public.agent_personas.llm_custom_model_id is
  'Model ID a pedir nesse servidor (ex.: o nome do modelo carregado no LM Studio). NULL = usa o padrão da conta.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.agent_personas
  drop column if exists llm_custom_url,
  drop column if exists llm_custom_model_id;
`);
  }
}
