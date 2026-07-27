import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { ChatSendService } from './chat-send.service';
import { SendMessageDto } from './dto/send-message.dto';

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
}
