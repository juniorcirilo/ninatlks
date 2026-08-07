import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class N8nAddNodeSpecDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  type!: string;

  @IsNumber()
  typeVersion!: number;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

/** Corpo de `POST /agent-sources/n8n/add-node` — mesmos campos de AddNodeToWorkflowInput, sem accountId (já vem da URL). */
export class N8nAddNodeDto {
  @IsString()
  @MinLength(1)
  workflowId!: string;

  @ValidateNested()
  @Type(() => N8nAddNodeSpecDto)
  node!: N8nAddNodeSpecDto;

  @IsOptional()
  @IsBoolean()
  connectToLastNode?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  spacing?: number;

  @IsOptional()
  @IsIn(['horizontal', 'vertical'])
  direction?: 'horizontal' | 'vertical';
}
