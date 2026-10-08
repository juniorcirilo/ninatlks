import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SaveConnectionDto {
  /** endpoint compatível com a API da OpenAI (ex.: https://api.openai.com/v1) */
  @IsOptional() @IsString() @MaxLength(300) baseUrl?: string;
  /** Só enviada quando digitada: a chave nunca volta ao navegador. */
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(200) modelId?: string;
}

export class ProbeDto extends SaveConnectionDto {}

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(8000) systemPrompt?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number;
  /** esforço/raciocínio (reasoning_effort, quando o modelo aceita); '' = padrão */
  @IsOptional()
  @IsIn(['', 'minimal', 'low', 'medium', 'high', 'max'])
  effort?: string;
  @IsOptional() @IsIn(['curta', 'media', 'longa']) replyLength?: string;
  /** '' = responde no mesmo idioma usado pelo cliente (padrão) */
  @IsOptional() @IsIn(['', 'pt-BR', 'en', 'es']) replyLanguage?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) historyTurns?: number;
  /** modelos tentados em ordem quando o principal falha */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  fallbackModels?: string[];
}

export class SkillDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(20000) body!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  /** opcional: derivado do nome quando ausente */
  @IsOptional()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  @MaxLength(64)
  slug?: string;
  /** agente (persona) dono da skill; vazio = skill geral */
  @IsOptional() @IsUUID() personaId?: string;
}

export class UpdateSkillDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(20000) body?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class GenerateSkillDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsString() @MinLength(3) @MaxLength(4000) description!: string;
  /** agente (persona) a que a skill pertence */
  @IsOptional() @IsUUID() personaId?: string;
}

export class CreateToolDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  /** nome técnico (letras minúsculas, números e _); derivado do nome se ausente */
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{0,23}$/)
  slug?: string;
  @IsIn(['postgresql', 'mssql']) connection!: 'postgresql' | 'mssql';
  /** contexto do banco para o agente (o que há nas tabelas, convenções) */
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxRows?: number;
  /** restringe ao agente (persona); vazio = conta toda */
  @IsOptional() @IsUUID() personaId?: string;
}

export class UpdateToolDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxRows?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
