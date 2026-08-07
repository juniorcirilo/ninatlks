import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WEBHOOK_EVENTS, WEBHOOK_METHODS } from '../webhook-endpoints.service';

/** Patch parcial: só o que vier no corpo é alterado. */
export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsIn(WEBHOOK_METHODS as unknown as string[])
  method?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** `null` explícito desamarra o destino do agente (vira global). Omitido = não altera. */
  @IsOptional()
  @IsUUID()
  agent_id?: string | null;
}
