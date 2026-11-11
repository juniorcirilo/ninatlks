import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class PresignAttachmentDto {
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  filename!: string;

  @IsString()
  @MaxLength(127)
  @Matches(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i, {
    message: 'contentType inválido',
  })
  contentType!: string;
}
