import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InteractiveDraftService } from './interactive-draft.service';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { ChatSendService, type InteractiveInput } from './chat-send.service';
import {
  EditMessageDto,
  InteractiveDraftDto,
  SendContactDto,
  SendInteractiveMediaDto,
  ForwardMessageDto,
  PresenceDto,
  PresenceSubscribeDto,
  SendInteractiveDto,
  SendMediaDto,
  SendMessageDto,
  SendPixDto,
  SendSpeechDto,
} from './dto/send-message.dto';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function toInteractiveInput(dto: SendInteractiveDto): InteractiveInput {
  if (dto.kind === 'buttons') {
    if (!dto.buttons?.length) throw new BadRequestException('buttons required');
    for (const b of dto.buttons) {
      if (b.type === 'reply' && !b.id) b.id = b.displayText;
      if (b.type === 'url' && !b.url)
        throw new BadRequestException('url required for url button');
      if (b.type === 'copy' && !b.copyCode)
        throw new BadRequestException('copyCode required for copy button');
      if (b.type === 'call' && !b.phoneNumber)
        throw new BadRequestException('phoneNumber required for call button');
    }
    return {
      kind: 'buttons',
      title: dto.title,
      description: dto.description ?? dto.title,
      footer: dto.footer,
      buttons: dto.buttons,
    };
  }
  if (!dto.sections?.length || !dto.buttonText)
    throw new BadRequestException('sections and buttonText required');
  return {
    kind: 'list',
    title: dto.title,
    description: dto.description,
    footer: dto.footer,
    buttonText: dto.buttonText,
    sections: dto.sections,
  };
}

@UseGuards(AccountMemberGuard)
@Controller('accounts/:accountId/messages')
export class ChatSendController {
  constructor(
    private readonly service: ChatSendService,
    private readonly drafts: InteractiveDraftService,
  ) {}

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
      { replyTo: dto.replyToMessageId },
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
      { replyTo: dto.replyToMessageId },
    );
  }

  @Post('send-interactive')
  sendInteractive(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendInteractiveDto,
  ) {
    return this.service.sendInteractive(
      accountId,
      user.id,
      dto.conversationId,
      toInteractiveInput(dto),
      { replyTo: dto.replyToMessageId },
    );
  }

  @Post('send-interactive-media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async sendInteractiveMedia(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: SendInteractiveMediaDto,
    @UploadedFile()
    file?: { buffer: Buffer; originalname: string; mimetype: string },
  ) {
    if (!file) throw new BadRequestException('file required');
    let raw: unknown;
    try {
      raw = JSON.parse(body.payload);
    } catch {
      throw new BadRequestException('invalid payload');
    }
    const dto = plainToInstance(SendInteractiveDto, {
      ...(raw as object),
      conversationId: body.conversationId,
    });
    const errors = await validate(dto, { whitelist: true });
    if (errors.length)
      throw new BadRequestException(
        errors.flatMap((e) => Object.values(e.constraints ?? {})),
      );
    if (dto.kind !== 'buttons')
      throw new BadRequestException('media only with buttons');
    return this.service.sendInteractive(
      accountId,
      user.id,
      body.conversationId,
      toInteractiveInput(dto),
      { replyTo: body.replyToMessageId },
      file,
    );
  }

  @Post('send-pix')
  sendPix(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendPixDto,
  ) {
    return this.service.sendPix(
      accountId,
      user.id,
      dto.conversationId,
      dto,
      { replyTo: dto.replyToMessageId },
    );
  }

  @Post('send-contact')
  sendContact(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendContactDto,
  ) {
    return this.service.sendContact(
      accountId,
      user.id,
      dto.conversationId,
      { name: dto.name, phone: dto.phone },
      { replyTo: dto.replyToMessageId },
    );
  }

  @Post('interactive-draft')
  interactiveDraft(
    @Param('accountId') accountId: string,
    @Body() dto: InteractiveDraftDto,
  ) {
    return this.drafts.draft(
      accountId,
      dto.template,
      dto.prompt,
      dto.buttonMode,
    );
  }

  @Post(':messageId/resend')
  resend(
    @Param('accountId') accountId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.resend(accountId, user.id, messageId);
  }

  @Post('send-speech')
  sendSpeech(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendSpeechDto,
  ) {
    return this.service.sendSpeech(
      accountId,
      user.id,
      dto.conversationId,
      dto.content,
      { replyTo: dto.replyToMessageId },
    );
  }

  @Post(':messageId/transcribe')
  transcribe(
    @Param('accountId') accountId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.service.transcribeMessage(accountId, messageId);
  }

  @Patch(':messageId/edit')
  edit(
    @Param('accountId') accountId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.service.editMessage(accountId, messageId, dto.content);
  }

  @Delete(':messageId')
  remove(
    @Param('accountId') accountId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ) {
    return this.service.deleteMessage(accountId, messageId);
  }

  @Post('forward')
  forward(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ForwardMessageDto,
  ) {
    return this.service.forward(
      accountId,
      user.id,
      dto.messageId,
      dto.conversationIds,
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

  @Post('presence/subscribe')
  subscribePresence(
    @Param('accountId') accountId: string,
    @Body() dto: PresenceSubscribeDto,
  ) {
    return this.service.subscribePresence(accountId, dto.conversationIds);
  }
}
