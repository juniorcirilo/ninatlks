import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchNumbersDto {
  @IsOptional()
  @IsString()
  countryCode?: string;

  @IsOptional()
  @IsIn(['Local', 'TollFree', 'Mobile'])
  type?: 'Local' | 'TollFree' | 'Mobile';

  @IsOptional()
  @IsString()
  areaCode?: string;

  @IsOptional()
  @IsString()
  contains?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  voice?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sms?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mms?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
