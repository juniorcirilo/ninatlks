import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const TRIGGER_EVENTS = [
  'stage_change',
  'manual',
  'no_show',
  'meeting_attended',
];
const CHANNELS = ['voice', 'whatsapp', 'email'];

export class CadenceStepDto {
  @IsNumber()
  offset_hours!: number;

  @IsIn(CHANNELS)
  channel!: string;

  @IsOptional()
  @IsString()
  template_key?: string | null;
}

export class UpsertCadenceDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsIn(TRIGGER_EVENTS)
  trigger_event!: string;

  @IsOptional()
  @IsUUID()
  trigger_stage_id?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CadenceStepDto)
  steps!: CadenceStepDto[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class EnrollContactDto {
  @IsUUID()
  contactId!: string;
}
