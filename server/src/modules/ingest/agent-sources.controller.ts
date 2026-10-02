import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccountMemberGuard } from '../../common/guards/account-member.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/authenticated-request';
import { AgentSourcesService } from './agent-sources.service';
import { SecretsService } from '../secrets/secrets.service';
import { N8nIntegrationService } from '../n8n/n8n-integration.service';
import { N8nWorkflowService } from '../n8n/n8n-workflow.service';
import {
  CreateAgentSourceDto,
  UpdateAgentSourceDto,
} from './dto/agent-source.dto';
import { N8nEnsureNodeDto } from './dto/n8n-ensure-node.dto';
import { N8nAddNodeDto } from './dto/n8n-add-node.dto';
import { ResolveSyncFailureDto } from './dto/resolve-sync-failure.dto';

/**
 * Fontes de dados por agente: o produto busca no sistema do cliente em vez de
 * esperar o push. Só admin — a linha aponta para um sistema externo e tem
 * credencial associada.
 *
 * O token nunca trafega de volta: entra pelo corpo, vai para o vault
 * (`account_secrets`, provider `agent-source`), e a listagem devolve só
 * `has_token`.
 */
@UseGuards(AccountMemberGuard, RolesGuard)
@Roles('admin')
@Controller('accounts/:accountId/agent-sources')
export class AgentSourcesController {
  constructor(
    private readonly sources: AgentSourcesService,
    private readonly secrets: SecretsService,
    private readonly n8n: N8nIntegrationService,
    private readonly n8nWorkflow: N8nWorkflowService,
  ) {}

  @Get()
  list(@Param('accountId') accountId: string) {
    return this.sources.list(accountId);
  }

  /**
   * Ao clicar em "Configurar" para um agente sem fonte ainda: garante o nó
   * Webhook dele no workflow Utalks e devolve a URL pronta para pré-preencher
   * o formulário. Sem `agentId`/`sourceId` — a fonte ainda não existe no
   * nosso banco neste momento, o nome do agente já basta para nomear e achar
   * o nó no n8n.
   *
   * `configured: false` (200, não erro) quando a conta não tem n8n plugado —
   * é o caminho de 100% das contas até alguém conectar em Configurações >
   * Integrações, então isto não pode aparecer como falha na tela.
   */
  @Post('n8n/ensure-node')
  async ensureN8nNode(
    @Param('accountId') accountId: string,
    @Body() dto: N8nEnsureNodeDto,
  ) {
    if (!(await this.n8n.isConfigured(accountId))) {
      return { configured: false as const };
    }
    const result = await this.n8n.ensureAgentNode(accountId, {
      agentName: dto.agentName,
      method: dto.method ?? (process.env.N8N_HTTP_METHOD?.toUpperCase() === 'GET' ? 'GET' : 'POST'),
    });
    return { configured: true as const, ...result };
  }

  /**
   * Acrescenta um nó a um workflow do n8n já existente, sem tocar nos demais
   * nós, conexões ou configurações — é a capacidade genérica por trás do
   * ensure-node acima, exposta direto para quem quiser montar um nó
   * diferente de um Webhook (ex.: um HTTP Request chamando outro sistema).
   */
  @Post('n8n/add-node')
  addN8nNode(
    @Param('accountId') accountId: string,
    @Body() dto: N8nAddNodeDto,
  ) {
    return this.n8nWorkflow.addNodeToWorkflow(accountId, dto);
  }

  /**
   * Sincronizar com o n8n: para cada agente da conta —
   *  - já tem fonte de dados? só garante o nó dele no workflow Utalks (mesma
   *    idempotência do ensure-node) e não toca em mais nada — "se existir não
   *    mexa" vale tanto para o nó quanto para a fonte;
   *  - não tem fonte? garante o nó E cria a fonte na hora, apontando para a
   *    URL do nó recém-garantido. `field_map`/`variables_map` nascem vazios
   *    de propósito: não há como adivinhar os nomes de campo do ERP de
   *    ninguém, então a fonte fica "nunca testada" até um admin abrir
   *    "Editar" e preencher o mapeamento — criar automaticamente é dar a
   *    ponte pronta, não fingir que já sabemos o formato dos dados do cliente.
   */
  @Post('n8n/sync-all')
  async syncAllToN8n(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
  ) {
    if (!(await this.n8n.isConfigured(accountId))) {
      return { configured: false as const };
    }
    const agents = await this.sources.listAgentsForN8nSync(accountId);
    const allSources = await this.sources.list(accountId);
    const sourcesByAgent = new Map<string, { id: string; method: string }>(
      allSources.map((s: any) => [s.agent_id, { id: s.id, method: s.method }] as [string, { id: string; method: string }]),
    );
    const results: Array<{
      agentName: string;
      nodeCreated: boolean;
      sourceCreated: boolean;
      sourceUpdated: boolean;
      url?: string;
      error?: string;
    }> = [];
    for (const agent of agents) {
      try {
        const desiredMethod = process.env.N8N_HTTP_METHOD?.toUpperCase() === 'GET' ? 'GET' : 'POST';
        const node = await this.n8n.ensureAgentNode(accountId, {
          agentName: agent.agentName,
          method: desiredMethod,
        });
        let sourceCreated = false;
        let sourceUpdated = false;
        const existing = sourcesByAgent.get(agent.agentId);
        if (!existing) {
          await this.sources.create(accountId, user.id, {
            agentId: agent.agentId,
            name: `Fonte — ${agent.agentName}`,
            url: node.url,
            method: desiredMethod,
          });
          sourceCreated = true;
        } else if (existing.method !== desiredMethod) {
          await this.sources.update(accountId, existing.id, { method: desiredMethod });
          sourceUpdated = true;
        }
        results.push({
          agentName: agent.agentName,
          nodeCreated: node.created,
          sourceCreated,
          sourceUpdated,
          url: node.url,
        });
      } catch (err) {
        results.push({
          agentName: agent.agentName,
          nodeCreated: false,
          sourceCreated: false,
          sourceUpdated: false,
          error: (err as Error).message,
        });
      }
    }
    const agentNames = agents.map((a) => a.agentName);
    const validation = await this.n8n.validateAndDisableIncompleteAgentChains(accountId, agentNames);

    return {
      configured: true as const,
      total: results.length,
      nodesCreated: results.filter((r) => r.nodeCreated).length,
      sourcesCreated: results.filter((r) => r.sourceCreated).length,
      sourcesUpdated: results.filter((r) => r.sourceUpdated).length,
      validationDisabled: validation.disabled,
      validationErrors: validation.errors,
      results,
    };
  }

  @Post()
  async create(
    @Param('accountId') accountId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateAgentSourceDto,
  ) {
    const { token, ...rest } = dto;
    const created = await this.sources.create(accountId, user.id, rest);
    if (token) {
      await this.secrets.set(accountId, 'agent-source', created.id, token);
    }
    return created;
  }

  @Patch(':id')
  async update(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentSourceDto,
  ) {
    const { token, ...rest } = dto;
    const result = await this.sources.update(accountId, id, rest);
    // Token em branco significa "mantenha o que está guardado" — o formulário
    // não tem como reexibi-lo, então campo vazio não pode apagar a credencial.
    if (token) {
      await this.secrets.set(accountId, 'agent-source', id, token);
    }
    return result;
  }

  /** Busca agora: é o "Testar" da tela e o "Sincronizar" da lista operacional. */
  @Post(':id/run')
  async run(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sources.requireSource(accountId, id);
    return this.sources.run(id);
  }

  /**
   * Falhas da última corrida desta fonte (ver PersistAgentSourceSyncFailures)
   * — sobrevive ao fechamento do modal de sincronização, pra investigar
   * depois "por que só X dos Y chegaram" sem precisar sincronizar de novo.
   */
  @Get(':id/failures')
  async failures(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sources.requireSource(accountId, id);
    return this.sources.listFailures(accountId, id);
  }

  /**
   * Reconciliação manual de uma linha que a última corrida bloqueou por
   * "empresa não identificada" (Cobranças/Orçamentos > Itens não
   * sincronizados). Não depende do :id da fonte — a tela já tem tudo que
   * precisa (telefone/nome/email/variables) vindo do `details` da falha.
   */
  @Post('resolve-failure')
  async resolveFailure(
    @Param('accountId') accountId: string,
    @Body() dto: ResolveSyncFailureDto,
  ) {
    return this.sources.resolveSyncFailure(accountId, dto);
  }

  @Delete(':id')
  async remove(
    @Param('accountId') accountId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.sources.remove(accountId, id);
    await this.secrets.delete(accountId, 'agent-source', id);
    return result;
  }
}
