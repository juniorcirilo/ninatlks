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

export class PresenceSubscribeDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  conversationIds!: string[];
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

export class EditMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

export class SendSpeechDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  content!: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class SendInteractiveMediaDto {
  @IsUUID()
  conversationId!: string;

  /** SendInteractiveDto (sem conversationId) serializado em JSON. */
  @IsString()
  @MaxLength(20000)
  payload!: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export class SendContactDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}

export const DRAFT_TEMPLATES = [
  'buttons',
  'list',
  'image_buttons',
  'video_buttons',
  'pix',
  'link_image_buttons',
  'coupon',
  'promo',
  'launch',
  'event',
  'booking',
  'nps',
  'review',
  'cart',
] as const;
export type DraftTemplate = (typeof DRAFT_TEMPLATES)[number];

export class InteractiveDraftDto {
  @IsIn(DRAFT_TEMPLATES as unknown as string[])
  template!: DraftTemplate;

  @IsString()
  @MinLength(3)
  @MaxLength(1500)
  prompt!: string;

  /** Botões de resposta rápida ou de ação (link/ligar/copiar). */
  @IsOptional()
  @IsIn(['reply', 'action'])
  buttonMode?: 'reply' | 'action';
}

export class SendPixDto {
  @IsUUID()
  conversationId!: string;

  /** Chave PIX ou um "copia e cola" completo (começa com 000201). */
  @IsString()
  @MinLength(3)
  @MaxLength(600)
  key!: string;

  @IsIn(['cpf', 'cnpj', 'phone', 'email', 'random'])
  keyType!: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  footer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  beneficiary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  amount?: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
