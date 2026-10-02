import { Module } from '@nestjs/common';
import { EvolutionController } from './evolution.controller';
import { EvolutionService } from './evolution.service';
import { EvolutionDirectoryService } from './evolution-directory.service';
import { EvolutionClientService } from './evolution-client.service';

@Module({
  controllers: [EvolutionController],
  providers: [
    EvolutionService,
    EvolutionClientService,
    EvolutionDirectoryService,
  ],
  exports: [EvolutionClientService],
})
export class EvolutionModule {}
