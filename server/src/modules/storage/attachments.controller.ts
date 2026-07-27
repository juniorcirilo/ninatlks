import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { StorageService } from './storage.service';
import { PresignAttachmentDto } from './dto/presign-attachment.dto';

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/attachments')
export class AttachmentsController {
  constructor(private readonly storageService: StorageService) {}

  @Post('presign')
  async presign(
    @Param('accountId') accountId: string,
    @Body() dto: PresignAttachmentDto,
  ) {
    const safeName = dto.filename.replace(/[^a-z0-9._-]/gi, '_');
    const key = `${accountId}/outgoing/${dto.conversationId}/${Date.now()}-${safeName}`;

    const [{ uploadUrl, bucket }, signedUrl] = await Promise.all([
      this.storageService.presignUpload(key, dto.contentType),
      this.storageService.presignDownload(key),
    ]);

    return {
      storagePath: `${bucket}/${key}`,
      uploadUrl,
      signedUrl,
      mimeType: dto.contentType,
    };
  }
}
