import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Vincula um cliente (contato) já existente a uma empresa. */
export class LinkCompanyDto {
  @IsUUID()
  contactId!: string;

  /** Empresa já escolhida na tela (busca por nome/empresa_id). */
  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** "empresa_id" — acha a empresa por esta chave, ou cria uma nova com ela. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  /** Nome pra empresa nova, quando não há companyId nem externalId. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class LinkCompanyRowDto {
  @IsString()
  @MaxLength(32)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class LinkCompanyImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => LinkCompanyRowDto)
  rows!: LinkCompanyRowDto[];
}
