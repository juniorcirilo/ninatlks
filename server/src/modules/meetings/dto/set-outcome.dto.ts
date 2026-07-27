import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetOutcomeDto {
  @IsIn(['scheduled', 'attended', 'no_show', 'rescheduled', 'canceled'])
  status!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
