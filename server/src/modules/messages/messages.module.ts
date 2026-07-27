import { Module } from '@nestjs/common';
import { EvolutionModule } from '../evolution/evolution.module';
import { ChatSendController } from './chat-send.controller';
import { ChatSendService } from './chat-send.service';

@Module({
  imports: [EvolutionModule],
  controllers: [ChatSendController],
  providers: [ChatSendService],
  exports: [ChatSendService],
})
export class MessagesModule {}
