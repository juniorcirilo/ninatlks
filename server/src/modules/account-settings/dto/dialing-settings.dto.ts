import { IsInt, IsObject, IsString, Min } from 'class-validator';

export class DialingSettingsDto {
  @IsString()
  timezone!: string;

  @IsObject()
  allowed_hours_local!: Record<string, [number, number] | null>;

  @IsInt()
  @Min(1)
  max_attempts_per_day!: number;

  @IsInt()
  @Min(1)
  min_minutes_between_attempts!: number;
}
