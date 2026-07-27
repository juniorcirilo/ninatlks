import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const CALL_PURPOSES = [
  'discovery',
  'reminder',
  'noshow_reschedule',
  'followup',
];

export class PlaceCallDto {
  @IsUUID()
  fromNumberId!: string;

  @IsString()
  toNumber!: string;

  @IsOptional()
  @IsUUID()
  personaId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  meetingId?: string;

  @IsOptional()
  @IsIn(CALL_PURPOSES)
  callPurpose?: string;

  @IsOptional()
  timeoutSeconds?: number;
}
