import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const PROVIDERS = [
  'twilio',
  'elevenlabs',
  'deepgram',
  'evolution',
  'zernio',
  'meta',
  'n8n',
  'custom-llm',
  'agent-llm',
  'smtp',
  'google_calendar',
  // Bancos externos consultados pelo Agente de IA (somente leitura).
  'postgresql',
  'mssql',
];

export class SetSecretDto {
  @IsIn(PROVIDERS)
  provider!: string;

  @IsString()
  keyName!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
