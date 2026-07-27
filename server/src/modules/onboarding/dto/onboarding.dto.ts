import { IsIn, IsObject, IsOptional } from 'class-validator';

const STEPS = [
  'welcome',
  'empresa',
  'elevenlabs',
  'twilio',
  'deepgram',
  'evolution',
  'agente',
  'numero',
  'done',
];

export class AdvanceStepDto {
  @IsIn(STEPS)
  step!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class GotoStepDto {
  @IsIn(STEPS)
  step!: string;
}
