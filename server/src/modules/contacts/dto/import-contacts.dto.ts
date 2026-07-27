import { IsArray, IsOptional, IsString } from 'class-validator';

class ImportRowDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;
}

export class ImportContactsDto {
  @IsArray()
  rows!: ImportRowDto[];
}
