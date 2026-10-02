import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  razaoSocial?: string | null;

  @IsOptional()
  @IsString()
  nomeFantasia?: string | null;

  @IsOptional()
  @IsUUID()
  vendedorId?: string | null;
}
