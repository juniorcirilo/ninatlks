import { IsUUID } from 'class-validator';

export class MoveLeadDto {
  @IsUUID()
  stageId!: string;
}
