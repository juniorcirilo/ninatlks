import { IsBoolean, IsOptional } from 'class-validator';

export class GenerateSummaryDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
