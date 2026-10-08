import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SessionManagerService } from './session-manager.service';
import { WaSendService } from './wa-send.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppDirectoryService } from './whatsapp-directory.service';
import { WhatsAppController } from './whatsapp.controller';

/**
 * WhatsApp direto (Baileys), uma sessão por canal. Não depende de Webhooks nem
 * de Messages (eles dependem deste); o pipeline de mensagens recebidas é ligado
 * pelo WaEventsService, que fica em WebhooksModule.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [WhatsAppController],
  providers: [
    SessionManagerService,
    WaSendService,
    WhatsAppService,
    WhatsAppDirectoryService,
  ],
  exports: [SessionManagerService, WaSendService],
})
export class WhatsAppModule {}
