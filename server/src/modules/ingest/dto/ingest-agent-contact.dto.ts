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
 * mandar a mesma pessoa duas vezes atualiza, não duplica.
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

  /** Código do registro no sistema de origem. Enriquecimento, não chave. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

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
}
