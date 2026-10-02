import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  /** Mensagem (id interno) que está sendo respondida. */
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class SendMediaDto {
  @IsUUID()
  conversationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  /** Mensagem (id interno) que está sendo respondida. */
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class ButtonDto {
  @IsIn(['reply', 'url', 'copy', 'call'])
  type!: 'reply' | 'url' | 'copy' | 'call';

  @IsString()
  @MinLength(1)
  @MaxLength(25)
  displayText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  copyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phoneNumber?: string;
}

export class RowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  rowId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(72)
  description?: string;
}

export class SectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  title!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RowDto)
  rows!: RowDto[];
}

export class SendInteractiveDto {
  @IsUUID()
  conversationId!: string;

  @IsIn(['buttons', 'list'])
  kind!: 'buttons' | 'list';

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  /** kind = buttons */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ButtonDto)
  buttons?: ButtonDto[];

  /** kind = list */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  buttonText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SectionDto)
  sections?: SectionDto[];

  /** Mensagem (id interno) que está sendo respondida. */
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class PresenceDto {
  @IsUUID()
  conversationId!: string;

  @IsIn(['composing', 'recording', 'paused'])
  presence!: 'composing' | 'recording' | 'paused';
}

export class ForwardMessageDto {
  @IsUUID()
  messageId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  conversationIds!: string[];
}
