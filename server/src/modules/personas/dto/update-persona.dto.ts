import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdatePersonaDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['draft', 'training', 'active', 'retired', 'archived'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  voiceProvider?: string;

  @IsOptional()
  @IsString()
  voiceCloneId?: string;

  @IsOptional()
  @IsObject()
  voiceConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  firstMessage?: string;

  @IsOptional()
  @IsObject()
  turnConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  ttsConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString({ each: true })
  asrKeywords?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  llmTemperature?: number;

  @IsOptional()
  @IsInt()
  llmMaxTokens?: number;

  @IsOptional()
  @IsString()
  llmModel?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
