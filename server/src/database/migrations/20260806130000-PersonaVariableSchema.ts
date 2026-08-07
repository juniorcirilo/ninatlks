import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cada agente (persona) tem seu próprio conjunto de dados de contato — Diego
 * (cobrança) precisa de dias_em_atraso/valor_devedor_saldo, Sofia (SDR) de
 * numero_orcamento/status_orcamento. Antes disso, a tela de criar lista só
 * conhecia um catálogo fixo por "tipo de operação" (sdr/cobranca/…), então o
 * formulário de "adicionar contato específico" mostrava campos genéricos que
 * não batiam com o agente escolhido.
 *
 * `variable_schema` fica na persona (cadastrado uma vez, reaproveitado em
 * toda lista/carga daquele agente). `contact_lists.persona_id` lembra qual
 * agente originou a lista, para o formulário manual e a documentação de
 * webhook usarem o conjunto certo mesmo reabrindo a lista depois.
 */
export class PersonaVariableSchema20260806130000 implements MigrationInterface {
  name = 'PersonaVariableSchema20260806130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.agent_personas
  add column if not exists variable_schema jsonb not null default '[]';
`);
    await queryRunner.query(`
comment on column public.agent_personas.variable_schema is
  'Campos de dados esperados para este agente (ex.: dias_em_atraso, numero_orcamento). Array de {field, desc, required, example}. Usado no formulário manual de lista e no template de webhook/n8n.';
`);
    await queryRunner.query(`
alter table public.contact_lists
  add column if not exists persona_id uuid references public.agent_personas(id) on delete set null;
`);
    await queryRunner.query(`
comment on column public.contact_lists.persona_id is
  'Agente escolhido ao criar a lista — decide quais campos aparecem em "adicionar contato específico". NULL em listas antigas ou sem agente definido.';
`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
alter table public.contact_lists
  drop column if exists persona_id;
`);
    await queryRunner.query(`
alter table public.agent_personas
  drop column if exists variable_schema;
`);
  }
}
