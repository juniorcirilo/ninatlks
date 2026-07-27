import { Module } from '@nestjs/common';
import {
  CampaignsController,
  RetentionRulesController,
} from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { VoiceModule } from '../voice/voice.module';

@Module({
  imports: [VoiceModule],
  controllers: [CampaignsController, RetentionRulesController],
  providers: [CampaignsService],
})
export class CampaignsModule {}
