import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class VoiceSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  stability?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  similarity_boost?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  style?: number;

  @IsOptional()
  @IsBoolean()
  use_speaker_boost?: boolean;
}

export class PreviewVoiceDto {
  @IsString()
  text!: string;

  @IsString()
  voiceId!: string;

  @IsOptional()
  @IsObject()
  voiceSettings?: VoiceSettingsDto;

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  languageCode?: string;
}

export class AgentSyncDto {
  @IsString()
  personaId!: string;
}

export class KbAddDto {
  @IsString()
  personaId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  type?: 'url' | 'text' | 'file';

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  text?: string;
}

export class CallAudioDto {
  @IsString()
  voiceCallId!: string;
}
