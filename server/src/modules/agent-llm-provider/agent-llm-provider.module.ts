import { Module } from '@nestjs/common';
import { AgentLlmProviderController } from './agent-llm-provider.controller';
import { AgentLlmProviderService } from './agent-llm-provider.service';

@Module({
  controllers: [AgentLlmProviderController],
  providers: [AgentLlmProviderService],
})
export class AgentLlmProviderModule {}
