import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_ATTEMPTS_PER_DAY_OPTIONS,
  MIN_MINUTES_BETWEEN_ATTEMPTS_OPTIONS,
} from './create-campaign.dto';

/**
 * Edição de campanha a partir da listagem — só os campos que fazem sentido
 * mudar depois de criada. Lista, agente e número ficam de fora: trocá-los
 * exigiria refazer a fila de `voice_campaign_contacts`, que é criação de outra
 * campanha, não edição desta.
 *
 * `scheduledAt: null` desagenda (volta pra 'draft'); string ISO reagenda.
 */
export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  openingScript?: string | null;

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

  @IsOptional()
  @IsDateString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsIn(MIN_MINUTES_BETWEEN_ATTEMPTS_OPTIONS)
  minMinutesBetweenAttempts?: number;

  @IsOptional()
  @IsIn(MAX_ATTEMPTS_PER_DAY_OPTIONS)
  maxAttemptsPerDay?: number;
}
