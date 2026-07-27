import { IsOptional, IsString, IsUUID } from 'class-validator';

export class TestEvolutionDto {
  @IsString()
  evolutionUrl!: string;

  @IsString()
  evolutionApiKey!: string;
}

export class ProvisionEvolutionDto {
  @IsString()
  evolutionUrl!: string;

  @IsString()
  evolutionApiKey!: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsString()
  channelName?: string;
}
