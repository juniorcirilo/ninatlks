import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateContactOpsDto {
  @IsOptional()
  @IsString()
  lifecycleStage?: string;

  @IsOptional()
  @IsString()
  operationalStatus?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;
}
