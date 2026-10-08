import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ProvisionWhatsAppDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  channelName?: string;
}

export class PairingCodeDto {
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  phone!: string;
}

export class UpdateWhatsAppChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
