import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class BulkContactIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  contactIds!: string[];
}

export class BulkAssignOwnerDto extends BulkContactIdsDto {
  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;
}

export class BulkSetLifecycleDto extends BulkContactIdsDto {
  @IsIn(['lead', 'prospect', 'customer', 'inactive', 'delinquent'])
  stage!: string;
}

export class BulkSetOperationalStatusDto extends BulkContactIdsDto {
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
  status!: string;
}

export class BulkAddTagDto extends BulkContactIdsDto {
  @IsString()
  tag!: string;
}

export class BulkRoundRobinDto extends BulkContactIdsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ownerIds!: string[];
}

export class BulkAddToCampaignDto {
  @IsUUID()
  campaignId!: string;

  @IsArray()
  contacts!: { id: string; phoneNumber: string | null }[];
}
