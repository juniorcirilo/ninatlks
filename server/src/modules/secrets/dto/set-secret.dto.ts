import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

const PROVIDERS = [
  'twilio',
  'elevenlabs',
  'deepgram',
  'evolution',
  'zernio',
  'meta',
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
