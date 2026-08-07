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

export class CreateWebhookEndpointDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /**
   * `require_tld: false` para o destino conseguir ser um host interno da rede
   * do cliente (n8n auto-hospedado em `http://n8n:5678/...`), que é o caso
   * mais comum aqui e não tem TLD.
   */
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2000)
  url!: string;

  /**
   * Padrão POST. GET existe porque o nó Webhook do n8n criado pro lado de
   * entrada (agente → ERP) costuma nascer em GET (`N8N_HTTP_METHOD`), e é
   * comum o cliente reaproveitar a mesma URL como destino de saída.
   */
  @IsOptional()
  @IsIn(WEBHOOK_METHODS as unknown as string[])
  method?: string;

  /** Vazio = todos os eventos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WEBHOOK_EVENTS.length)
  @IsIn(WEBHOOK_EVENTS as unknown as string[], { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Restringe o destino a um agente da conta. Omitido/null = destino global. */
  @IsOptional()
  @IsUUID()
  agent_id?: string | null;
}
