import {
  IsBoolean,
  IsOptional,
  Matches,
  IsString,
  IsUUID,
} from 'class-validator';

export class TestEvolutionDto {
  @IsString()
  evolutionUrl!: string;

  @IsString()
  evolutionApiKey!: string;
}

export class ProvisionEvolutionDto {
  /** Omitidos → reaproveita o servidor Evolution já configurado na conta. */
  @IsOptional()
  @IsString()
  evolutionUrl?: string;

  @IsOptional()
  @IsString()
  evolutionApiKey?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{3,60}$/, {
    message: 'instanceName: 3–60 caracteres (letras, números, _ e -)',
  })
  instanceName?: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsString()
  channelName?: string;
}

export class UpdateEvolutionChannelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
