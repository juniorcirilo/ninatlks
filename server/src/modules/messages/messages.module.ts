import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { ChatSendController } from './chat-send.controller';
import { ChatSendService } from './chat-send.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PersonaAutoReplyService } from './persona-auto-reply.service';

@Module({
  imports: [EvolutionModule],
  controllers: [ChatSendController, ConversationsController],
  providers: [ChatSendService, ConversationsService, PersonaAutoReplyService],
  exports: [ChatSendService, PersonaAutoReplyService],
})
export class MessagesModule {}
