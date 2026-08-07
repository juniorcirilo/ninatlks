import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentLlmProviderService } from './agent-llm-provider.service';
import { ListModelsDto } from './dto/list-models.dto';
import { TestConnectionDto } from './dto/test-connection.dto';

/**
 * Suporte pra tela "Provedor de IA do Agente" (Configurações → Integrações):
 * lista modelos e testa conexão contra o provedor escolhido, direto do
 * backend (não do navegador — CORS + a key não deveria trafegar client-side).
 * Salvar a config em si usa o endpoint genérico de secrets (provider
 * 'agent-llm'), sem duplicar aqui.
 */
@UseGuards(AccountMemberGuard, RolesGuard)
@Controller('accounts/:accountId/agent-llm-provider')
export class AgentLlmProviderController {
  constructor(private readonly service: AgentLlmProviderService) {}

  @Post('models')
  @Roles('admin')
  listModels(@Body() dto: ListModelsDto) {
    return this.service.listModels(dto);
  }

  @Post('test')
  @Roles('admin')
  testConnection(@Body() dto: TestConnectionDto) {
    return this.service.testConnection(dto);
  }
}
