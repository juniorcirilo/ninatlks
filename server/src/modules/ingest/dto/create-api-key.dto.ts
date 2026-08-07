import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIP,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name!: string;

  /**
   * Opcional, e vazio por padrão. Faz sentido para n8n auto-hospedado, que sai
   * de um IP fixo; para n8n Cloud é melhor deixar em branco, porque as faixas
   * de saída mudam sem aviso e a integração cairia sozinha.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIP(undefined, { each: true })
  ipAllowlist?: string[];

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
