import { IsOptional, IsString } from 'class-validator';

export class AddDncDto {
  @IsString()
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
