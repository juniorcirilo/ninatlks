import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class StartConversationDto {
  @IsUUID()
  contactId!: string;
}

export class StartByJidDto {
  @IsString()
  @MaxLength(120)
  jid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  picture?: string;
}
