import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SetMemberPasswordDto {
  /** Omitido → o servidor gera uma senha aleatória e a devolve uma única vez. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}
