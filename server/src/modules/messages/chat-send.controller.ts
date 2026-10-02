import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { ChatSendService, type InteractiveInput } from './chat-send.service';
import {
  PresenceDto,
  SendInteractiveDto,
  SendMediaDto,
  SendMessageDto,
} from './dto/send-message.dto';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/messages')
export class ChatSendController {
  constructor(private readonly service: ChatSendService) {}

  @Post('send')
  send(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.service.send(
      accountId,
      user.id,
      dto.conversationId,
      dto.content,
    );
  }

  @Post('send-media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  sendMedia(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendMediaDto,
    @UploadedFile()
    file?: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file) throw new BadRequestException('file required');
    return this.service.sendMedia(
      accountId,
      user.id,
      dto.conversationId,
      file,
      dto.caption,
    );
  }

  @Post('send-interactive')
  sendInteractive(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendInteractiveDto,
  ) {
    let input: InteractiveInput;
    if (dto.kind === 'buttons') {
      if (!dto.buttons?.length)
        throw new BadRequestException('buttons required');
      for (const b of dto.buttons) {
        if (b.type === 'reply' && !b.id) b.id = b.displayText;
        if (b.type === 'url' && !b.url)
          throw new BadRequestException('url required for url button');
        if (b.type === 'copy' && !b.copyCode)
          throw new BadRequestException('copyCode required for copy button');
        if (b.type === 'call' && !b.phoneNumber)
          throw new BadRequestException('phoneNumber required for call button');
      }
      input = {
        kind: 'buttons',
        title: dto.title,
        description: dto.description ?? dto.title,
        footer: dto.footer,
        buttons: dto.buttons,
      };
    } else {
      if (!dto.sections?.length || !dto.buttonText)
        throw new BadRequestException('sections and buttonText required');
      input = {
        kind: 'list',
        title: dto.title,
        description: dto.description,
        footer: dto.footer,
        buttonText: dto.buttonText,
        sections: dto.sections,
      };
    }
    return this.service.sendInteractive(
      accountId,
      user.id,
      dto.conversationId,
      input,
    );
  }

  @Post('presence')
  presence(@Param('accountId') accountId: string, @Body() dto: PresenceDto) {
    return this.service.sendPresence(
      accountId,
      dto.conversationId,
      dto.presence,
    );
  }
}
