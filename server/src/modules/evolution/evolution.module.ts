import { Module } from '@nestjs/common';
import { EvolutionController } from './evolution.controller';
import { EvolutionService } from './evolution.service';
import { EvolutionClientService } from './evolution-client.service';

@Module({
  controllers: [EvolutionController],
  providers: [EvolutionService, EvolutionClientService],
  exports: [EvolutionClientService],
})
export class EvolutionModule {}
