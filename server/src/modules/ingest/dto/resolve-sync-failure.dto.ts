import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Reconciliação manual de uma linha de sync que ficou sem empresa
 * (`ingest_agent_contact` bloqueou por falta de `externalId`/`companyId`
 * quando a persona é de cobrança/orçamento — ver
 * IngestRequireCompanyForDocuments20260908050000). A tela reenvia os
 * mesmos dados que já tinha da falha (telefone/nome/email/variables, do
 * próprio `details` que a corrida anterior devolveu) mais a empresa que o
 * operador escolheu ou acabou de criar.
 */
export class ResolveSyncFailureDto {
  @IsUUID()
  agent!: string;

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

  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @IsUUID()
  companyId!: string;
}
