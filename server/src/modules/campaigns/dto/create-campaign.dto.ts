import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const CAMPAIGN_KINDS = [
  'sdr',
  'pos_venda',
  'cobranca',
  'retencao',
  'custom',
];

/** Opções de intervalo mínimo entre tentativas, em minutos. */
export const MIN_MINUTES_BETWEEN_ATTEMPTS_OPTIONS = [1, 5, 10, 15, 30, 60];

/**
 * Opções de teto de tentativas por dia, por número. 1000 existe para
 * validação de pipeline — na prática desliga o limite.
 */
export const MAX_ATTEMPTS_PER_DAY_OPTIONS = [1, 2, 3, 5, 10, 25, 50, 100, 1000];

export class CreateCampaignDto {
  @IsString()
  name!: string;

  @IsIn(CAMPAIGN_KINDS)
  campaignKind!: string;

  @IsUUID()
  listId!: string;

  @IsUUID()
  personaId!: string;

  @IsUUID()
  phoneId!: string;

  @IsOptional()
  @IsString()
  openingScript?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxConcurrent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  retryAttempts?: number;

  @IsOptional()
  @IsBoolean()
  recordCall?: boolean;

  /**
   * Intervalo mínimo entre tentativas ao mesmo número, em minutos. Ausente =
   * herda o padrão da conta e, na falta dele,
   * DEFAULT_MIN_MINUTES_BETWEEN_ATTEMPTS. Lista fechada porque é uma regra de
   * compliance: valor livre convidaria a colocar 0 e discar em loop.
   */
  @IsOptional()
  @IsIn(MIN_MINUTES_BETWEEN_ATTEMPTS_OPTIONS)
  minMinutesBetweenAttempts?: number;

  /**
   * Momento do disparo, ISO 8601 com offset. Ausente = campanha nasce em
   * 'draft' e só dispara quando alguém muda o status pra 'running' na mão
   * (comportamento anterior). Presente e no futuro = nasce em 'scheduled' e o
   * tick de dispatch promove pra 'running' na hora marcada.
   */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  /**
   * `off` (padrão): a campanha é um retrato da lista no momento da criação —
   * cargas posteriores do ERP não a alteram.
   *
   * `approval`: a campanha acompanha a lista. Membro novo vira lote pendente,
   * que só entra na fila depois que alguém aprova na tela. É o modo para
   * carteira recalculada todo dia (cobrança), onde criar campanha nova a cada
   * manhã perderia histórico e funil.
   */
  @IsOptional()
  @IsIn(['off', 'approval'])
  autoEnrollMode?: 'off' | 'approval';
}
