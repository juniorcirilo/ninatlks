import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class UpdateContactOpsDto {
  @IsOptional()
  @IsIn(['lead', 'prospect', 'customer', 'inactive', 'delinquent'])
  lifecycleStage?: string;

  @IsOptional()
  @IsIn([
    'new',
    'sdr',
    'qualifying',
    'negotiating',
    'closed_won',
    'closed_lost',
    'collections',
    'post_sale',
    'retention',
    'no_response',
    'do_not_contact',
  ])
  operationalStatus?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;
}
