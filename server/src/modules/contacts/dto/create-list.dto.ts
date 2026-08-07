import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CAMPAIGN_KINDS } from '../../campaigns/dto/create-campaign.dto';

export class CreateListDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  /**
   * Opcional: lista operacional que só vai ser alimentada por recebimento nasce
   * vazia, e exigir contato aqui obrigaria a criá-la duas vezes.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  contactIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  campaignKind?: string;

  /** Agente escolhido para esta lista — decide os campos do formulário manual. */
  @IsOptional()
  @IsUUID()
  personaId?: string;

  /**
   * Chave que o payload de recebimento manda em `listKey` para cair nesta
   * lista. Única por conta.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(128)
  externalKey?: string;
}

export class UpdateListDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  campaignKind?: string;

  /** Agente escolhido para esta lista — decide os campos do formulário manual. */
  @IsOptional()
  @IsUUID()
  personaId?: string | null;

  /** String vazia limpa a chave e desliga o recebimento nesta lista. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalKey?: string | null;
}

export class AddToListDto {
  @IsArray()
  @IsUUID('4', { each: true })
  contactIds!: string[];
}
