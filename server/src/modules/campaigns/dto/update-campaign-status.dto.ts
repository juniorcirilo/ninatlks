import { IsIn } from 'class-validator';

export class UpdateCampaignStatusDto {
  @IsIn(['draft', 'scheduled', 'running', 'paused', 'completed', 'canceled'])
  status!: string;
}
