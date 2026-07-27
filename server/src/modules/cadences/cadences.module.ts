import { Module } from '@nestjs/common';
import { CadencesController } from './cadences.controller';
import { CadencesService } from './cadences.service';

@Module({
  controllers: [CadencesController],
  providers: [CadencesService],
})
export class CadencesModule {}
