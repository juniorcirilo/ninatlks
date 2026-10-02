import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CAMPAIGN_KINDS } from '../../campaigns/dto/create-campaign.dto';

/**
 * Recebimento de um contato para automação de agente. O telefone é a chave —
 * mandar a mesma pessoa duas vezes é ignorado (insert-only), não duplica nem
 * atualiza.
 */
export class IngestAgentContactDto {
  /**
   * Id da persona de voz (uuid), como vem no template da tela de Webhooks >
   * Recebimento. Não é o slug do agente de chat: quem trabalha o contato é a
   * persona da campanha, e ela existe no banco com id próprio.
   */
  @IsUUID()
  agent!: string;

  /** Aceita formato local ou E.164 — a normalização é feita aqui. */
  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  /**
   * Código do cliente no sistema de origem. Chave de deduplicação do
   * contato E da empresa vinculada (`public.companies`, achada/criada por
   * este mesmo external_id) — sem ele, razaoSocial/nomeFantasia/vendedorNome
   * abaixo são ignorados (não dá pra saber a qual cliente pertencem).
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  /**
   * "empresa_id" — chave da EMPRESA no sistema de origem, separada de
   * `externalId` (que identifica o contato/pessoa). Antes, `externalId`
   * fazia as duas coisas: se a fonte mapeasse um código por pessoa nesse
   * campo (não por empresa), cada cliente virava sua própria empresa. Achada/
   * criada em `public.companies` por este campo — sem ele, a linha é
   * bloqueada quando a persona é de cobrança/orçamento (document_kind).
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  empresaId?: string;

  /** Nome da empresa, como o ERP manda — prioridade máxima como nome de
   * `companies.name` na criação (antes de razaoSocial/nomeFantasia). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  empresaNome?: string;

  /** Razão social do cliente — vai para `companies.razao_social`, não para o contato. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  razaoSocial?: string;

  /** Nome fantasia do cliente — vai para `companies.nome_fantasia`. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nomeFantasia?: string;

  /**
   * Nome do vendedor responsável, como o ERP manda. É casado contra os
   * usuários da conta; achando exatamente um, vira `companies.vendedor_id`
   * (a pessoa de verdade). Sem match (ou mais de um), fica só como texto em
   * `companies.vendedor_nome_erp` — nunca é perdido, mas também não linka a
   * pessoa errada.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  vendedorNome?: string;

  /** Contexto que a agente usa na fala (valor, pedido, interesse…). */
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  /**
   * Tipo da lista operacional criada para o agente (`sdr`, `cobranca`,
   * `pos_venda`, `retencao`, `custom`). Só preenche; carga sem o campo não
   * apaga o tipo que o operador já ajustou na tela.
   */
  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  campaignKind?: string;

  /** Sobrescreve a lista de destino. Padrão: `agent:<agent>`. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  listKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  listName?: string;

  /**
   * Empresa já resolvida manualmente (fluxo de reconciliação da tela de
   * Cobranças/Orçamentos, quando a linha original não trouxe `externalId` e
   * o operador escolheu ou criou a empresa à mão). Quando presente, ignora
   * o casamento/criação por `externalId` e usa esta empresa diretamente —
   * ver `AgentSourcesService.resolveSyncFailure`.
   */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
