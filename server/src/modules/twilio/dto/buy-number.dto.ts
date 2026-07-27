import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const INBOUND_BEHAVIORS = [
  'ai_answer',
  'forward_to_agent',
  'voicemail',
  'suggest',
];

export class BuyNumberDto {
  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  friendlyName?: string;

  @IsOptional()
  @IsUUID()
  inboxId?: string | null;

  @IsOptional()
  @IsUUID()
  pinnedPersonaId?: string | null;

  @IsOptional()
  @IsIn(INBOUND_BEHAVIORS)
  inboundBehavior?: string;

  @IsOptional()
  @IsString()
  bundleSid?: string;

  @IsOptional()
  @IsString()
  addressSid?: string;
}

export class ImportNumberDto {
  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsUUID()
  pinnedPersonaId?: string | null;

  @IsOptional()
  @IsUUID()
  inboxId?: string | null;

  @IsOptional()
  @IsIn(INBOUND_BEHAVIORS)
  inboundBehavior?: string;
}
