import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ConfirmMeetingDto {
  @IsUUID()
  meeting_id!: string;
}

export class GetAvailabilityDto {
  @IsString()
  conversation_id!: string;

  @IsOptional()
  @IsString()
  specialty?: string;

  @IsOptional()
  @IsUUID()
  doctor_id?: string;

  @IsOptional()
  @IsString()
  doctor_name?: string;

  @IsOptional()
  @IsInt()
  duration_minutes?: number;

  @IsOptional()
  @IsInt()
  max_options?: number;

  @IsOptional()
  @IsInt()
  days_ahead?: number;
}

export class QualifyLeadDto {
  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsOptional()
  @IsString()
  nome?: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  cidade?: string;

  @IsOptional()
  @IsString()
  uf?: string;

  @IsOptional()
  @IsString()
  empresa?: string;

  @IsOptional()
  @IsString()
  cnpj?: string;

  @IsOptional()
  @IsString()
  dor_principal?: string;

  @IsOptional()
  @IsString()
  ferramenta_atual?: string;

  @IsOptional()
  @IsString()
  interesse?: string;

  @IsString()
  fase_pipeline!: string;

  @IsString()
  sentimento!: string;

  @IsOptional()
  @IsString()
  temperatura?: string;

  @IsOptional()
  @IsString()
  motivo_descarte?: string;

  @IsOptional()
  @IsString()
  proxima_acao?: string;

  @IsOptional()
  @IsString()
  observacao?: string;
}

export class RescheduleMeetingDto {
  @IsUUID()
  meeting_id!: string;

  @IsIn(['reschedule', 'cancel'])
  action!: 'reschedule' | 'cancel';

  @IsOptional()
  @IsISO8601()
  new_starts_at?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class RegistrarDesfechoCobrancaDto {
  @IsOptional()
  @IsString()
  conversation_id?: string;

  @IsIn([
    'quitou',
    'prometeu_pagar',
    'negociou_parcelas',
    'pediu_boleto',
    'contestou_divida',
    'sem_condicoes',
    'recusou_pagar',
    'no_answer',
    'wrong_number',
  ])
  desfecho!: string;

  @IsOptional()
  @IsString()
  valor_prometido?: string;

  @IsOptional()
  @IsISO8601()
  data_prometida?: string;

  @IsOptional()
  @IsString()
  forma_pagamento?: string;

  @IsOptional()
  @IsString()
  observacao?: string;
}

export class ScheduleMeetingDto {
  @IsString()
  conversation_id!: string;

  @IsUUID()
  doctor_id!: string;

  @IsISO8601()
  starts_at!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  modality?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
