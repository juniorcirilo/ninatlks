import { Module } from '@nestjs/common';
import { ElevenLabsController } from './elevenlabs.controller';
import { ElevenLabsService } from './elevenlabs.service';
import { ElevenLabsAgentService } from './elevenlabs-agent.service';
import { ElevenLabsClientService } from './elevenlabs-client.service';
import { ElevenLabsConfigService } from './elevenlabs-config.service';
import { ElevenLabsVoicesService } from './elevenlabs-voices.service';

@Module({
  controllers: [ElevenLabsController],
  providers: [
    ElevenLabsService,
    ElevenLabsAgentService,
    ElevenLabsClientService,
    ElevenLabsConfigService,
    ElevenLabsVoicesService,
  ],
  exports: [
    ElevenLabsClientService,
    ElevenLabsConfigService,
    ElevenLabsVoicesService,
  ],
})
export class ElevenLabsModule {}
