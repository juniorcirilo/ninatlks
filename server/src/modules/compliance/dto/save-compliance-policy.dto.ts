import { IsObject } from 'class-validator';

export class SaveCompliancePolicyDto {
  @IsObject()
  policy!: Record<string, unknown>;
}
