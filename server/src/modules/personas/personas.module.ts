import { Module } from '@nestjs/common';
import { PersonasController } from './personas.controller';
import { PersonaDeploymentsController } from './persona-deployments.controller';
import { PersonasService } from './personas.service';

@Module({
  controllers: [PersonasController, PersonaDeploymentsController],
  providers: [PersonasService],
})
export class PersonasModule {}
