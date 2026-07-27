import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePersonaDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  sourceUserId?: string;
}
