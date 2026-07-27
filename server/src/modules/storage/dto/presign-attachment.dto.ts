import { IsString, IsUUID } from 'class-validator';

export class PresignAttachmentDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  filename!: string;

  @IsString()
  contentType!: string;
}
