import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { OpencodeBridgeService } from './opencode-bridge.service';
import { ExternalDbService } from './external-db.service';
import { DbToolsService } from './db-tools.service';
import { McpTokenService } from './mcp-token.service';
import { McpController } from './mcp.controller';
import { UsageLogService } from './usage-log.service';

@Module({
  imports: [SecretsModule],
  controllers: [AiAgentController, McpController],
  providers: [
    AiAgentService,
    OpencodeBridgeService,
    ExternalDbService,
    DbToolsService,
    McpTokenService,
    UsageLogService,
  ],
  exports: [
    OpencodeBridgeService,
    McpTokenService,
    DbToolsService,
    ExternalDbService,
    UsageLogService,
  ],
})
export class AiAgentModule {}
