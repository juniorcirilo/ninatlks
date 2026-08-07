import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Um campo de dado esperado deste agente (ex.: dias_em_atraso, numero_orcamento). */
export class PersonaVariableFieldDto {
  @IsString()
  @MaxLength(64)
  field!: string;

  @IsString()
  @MaxLength(255)
  desc!: string;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  example?: unknown;
}

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
  @IsString()
  llmCustomUrl?: string | null;

  @IsOptional()
  @IsString()
  llmCustomModelId?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonaVariableFieldDto)
  variableSchema?: PersonaVariableFieldDto[];
}
