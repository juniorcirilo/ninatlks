import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CAMPAIGN_KINDS } from '../../campaigns/dto/create-campaign.dto';

export class CreateAgentSourceDto {
  /** Persona que vai trabalhar os contatos vindos desta fonte. */
  @IsUUID()
  agentId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  /** `require_tld: false` para ERP em host interno da rede do cliente. */
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2000)
  url!: string;

  @IsOptional()
  @IsIn(['GET', 'POST'])
  method?: 'GET' | 'POST';

  /** Não volta em nenhuma leitura: vai para o vault. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  token?: string;

  /** `Authorization` por padrão; `x-api-key` para quem manda o token pelado. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tokenHeader?: string;

  /** `Bearer ` por padrão; vazio para token sem esquema. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tokenPrefix?: string;

  /** Corpo do POST, quando o método é POST. */
  @IsOptional()
  @IsObject()
  bodyTemplate?: Record<string, unknown>;

  /** Onde mora a lista na resposta, ex.: `data.items`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  rootPath?: string;

  /** Campo nosso -> chave da fonte. Ex.: `{"name":"cliente_nome"}`. */
  @IsOptional()
  @IsObject()
  fieldMap?: Record<string, string>;

  /** Variável da fala -> chave da fonte. Ex.: `{"valor":"valor_aberto"}`. */
  @IsOptional()
  @IsObject()
  variablesMap?: Record<string, string>;

  /** Lista de destino. Padrão: a lista do agente. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  listKey?: string;

  @IsOptional()
  @IsIn(CAMPAIGN_KINDS)
  campaignKind?: string;

  /** Minutos entre buscas automáticas. Ausente = só busca manual. */
  @IsOptional()
  @IsInt()
  @Min(5)
  scheduleMinutes?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateAgentSourceDto extends CreateAgentSourceDto {
  @IsOptional()
  @IsUUID()
  declare agentId: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  declare name: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(2000)
  declare url: string;
}
