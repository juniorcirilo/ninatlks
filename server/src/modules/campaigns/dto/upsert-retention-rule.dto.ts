import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpsertRetentionRuleDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  inactiveDays?: number;

  @IsOptional()
  @IsUUID()
  requiredStageId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  requiredTagIds?: string[];

  @IsOptional()
  @IsUUID()
  targetCampaignId?: string | null;

  @IsOptional()
  @IsInt()
  maxEnrollsPerRun?: number;
}
