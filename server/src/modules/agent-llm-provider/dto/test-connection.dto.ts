import { IsIn, IsOptional, IsString } from 'class-validator';
import { AGENT_LLM_PROVIDERS } from '../providers';

const PROVIDER_IDS = AGENT_LLM_PROVIDERS.map((p) => p.id);

export class TestConnectionDto {
  @IsIn(PROVIDER_IDS)
  provider!: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsString()
  modelId!: string;
}
