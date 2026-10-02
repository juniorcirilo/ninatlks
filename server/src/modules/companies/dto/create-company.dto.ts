import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateCompanyDto {
  /** "empresa_id" — chave do cliente no sistema de origem. Opcional na
   * criação manual (empresa só do produto, sem vínculo de ERP), mas é o
   * campo usado como chave no import em massa. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  razaoSocial?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nomeFantasia?: string | null;

  @IsOptional()
  @IsUUID()
  vendedorId?: string | null;
}
