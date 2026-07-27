import { IsString, IsUUID } from 'class-validator';

export class VoiceCloneDto {
  @IsUUID()
  personaId!: string;

  @IsString()
  audioBase64!: string;

  @IsString()
  filename!: string;

  @IsString()
  mimeType!: string;
}
