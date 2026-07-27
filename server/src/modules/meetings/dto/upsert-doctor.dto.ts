import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpsertDoctorDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  specialty?: string | null;

  @IsArray()
  @IsString({ each: true })
  modalities!: string[];

  @IsInt()
  defaultDurationMinutes!: number;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
