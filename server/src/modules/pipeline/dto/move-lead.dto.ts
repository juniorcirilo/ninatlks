import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class MoveLeadDto {
  @IsUUID()
  stageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
