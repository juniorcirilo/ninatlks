import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class DeployPersonaDto {
  @IsUUID()
  personaId!: string;

  @IsUUID()
  inboxId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['always', 'after_hours', 'overflow', 'shadow', 'cron'])
  mode?: string;

  @IsOptional()
  @IsIn(['auto', 'suggest', 'shadow'])
  autonomy?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceThreshold?: number;

  @IsOptional()
  @IsInt()
  dailyMessageBudget?: number;
}
