import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CAMPAIGN_KINDS } from '../../campaigns/dto/create-campaign.dto';

/**
 * Uma linha da carga. `variables` é o que diferencia esta ingestão do import
 * de CSV: é o conteúdo da operação (valor do título, vencimento, número do
 * orçamento) que chega até a fala da agente como variável dinâmica.
 */
export class IngestRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;
}

export class IngestListDto {
  /** Chave estável da lista no sistema de origem — torna a carga idempotente. */
  @IsString()
  @MaxLength(128)
  listKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  listName?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  campaignKind?: string;

  /**
   * Em true, quem não veio nesta carga sai da lista — é o modo certo para
   * "carteira do dia" vinda do ERP: título pago ontem para de ser ligado hoje.
   * Em false, a carga só acrescenta.
   */
  @IsOptional()
  @IsBoolean()
  replaceMembers?: boolean;

  // 5.000 por requisição: o upsert roda linha a linha dentro de uma
  // transação só, e um corpo maior que isso segura a conexão tempo demais.
  // Carga maior deve ser paginada pelo n8n (o listKey mantém a idempotência,
  // mas replaceMembers só pode vir na última página — senão cada página apaga
  // o que a anterior inseriu).
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => IngestRowDto)
  rows!: IngestRowDto[];
}
