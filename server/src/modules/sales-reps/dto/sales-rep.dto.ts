import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class UpsertSalesRepDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  /** Outras grafias do nome como o ERP envia (ex.: "JAIME J. SILVA"). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  /** Aceita "(41) 99999-0000", "+5541999990000"…; normalizado para E.164. */
  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** COMERCIAL (default) ou FINANCEIRO — cobrança só transborda para FINANCEIRO. */
  @IsOptional()
  @IsIn(['COMERCIAL', 'FINANCEIRO'])
  departamento?: 'COMERCIAL' | 'FINANCEIRO';

  /** Atendente padrão do departamento (um ativo por departamento). Exige telefone. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** Como a IA cita o destino (ex.: "nossa central de atendimento comercial"). */
  @IsOptional()
  @IsString()
  nomeFalado?: string | null;
}

export class BulkSalesRepsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpsertSalesRepDto)
  items!: UpsertSalesRepDto[];
}
