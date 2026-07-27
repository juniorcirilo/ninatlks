import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const CAMPAIGN_KINDS = ['sdr', 'pos_venda', 'cobranca', 'retencao', 'custom'];

export class CreateCampaignDto {
  @IsString()
  name!: string;

  @IsIn(CAMPAIGN_KINDS)
  campaignKind!: string;

  @IsUUID()
  listId!: string;

  @IsUUID()
  personaId!: string;

  @IsUUID()
  phoneId!: string;

  @IsOptional()
  @IsString()
  openingScript?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxConcurrent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  retryAttempts?: number;

  @IsOptional()
  @IsBoolean()
  recordCall?: boolean;
}
