import { Module } from '@nestjs/common';
import { IntegrationsStatusModule } from '../integrations-status/integrations-status.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [IntegrationsStatusModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
