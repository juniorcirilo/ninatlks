import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

const INBOUND_BEHAVIORS = [
  'ai_answer',
  'suggest',
  'forward_to_agent',
  'voicemail',
];

export class CreatePhoneNumberDto {
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'e164 must be a valid E.164 number',
  })
  e164!: string;

  @IsOptional()
  @IsString()
  friendlyName?: string;

  @IsOptional()
  @IsUUID()
  inboxId?: string;

  @IsOptional()
  @IsUUID()
  pinnedPersonaId?: string;

  @IsOptional()
  @IsIn(INBOUND_BEHAVIORS)
  inboundBehavior?: string;
}

export class UpdatePhoneNumberDto {
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
  @IsBoolean()
  outboundEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
