import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import type { ApiKeyRequest } from './api-key-request';
import {
  AgentContactBodyPipe,
  type AgentContactBody,
} from './agent-contact-body.pipe';
import { IngestListDto } from './dto/ingest-list.dto';
import { IngestService } from './ingest.service';

/**
 * Superfície de integração para sistema externo (ERP via n8n, auto-hospedado
 * ou Cloud). Fora de `/accounts/:accountId/...` de propósito: a conta vem da
 * chave de API, não da URL, então uma chave não tem como apontar para conta
 * alheia nem por engano de configuração no n8n.
 *
 * @Public() em toda rota porque o SessionAuthGuard global espera cookie de
 * sessão de navegador; a autenticação real é o ApiKeyGuard aplicado na classe.
 */
@Controller('ingest')
@UseGuards(ApiKeyGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  /**
   * Carga de lista operacional. Idempotente por `listKey`: rodar de novo
   * atualiza a mesma lista em vez de criar outra, o que deixa o n8n reexecutar
   * o workflow sem medo.
   */
  @Public()
  @Post('operational-list')
  @HttpCode(200)
  operationalList(@Req() req: ApiKeyRequest, @Body() dto: IngestListDto) {
    return this.ingest.ingestOperationalList(req.apiKey.accountId, dto);
  }

  /**
   * Recebimento para automação de agente, upsert pelo telefone — é o endpoint
   * que os templates da tela de Webhooks > Recebimento geram.
   *
   * Aceita um contato (`{…}`) ou lote (`[{…}, {…}]`). A resposta acompanha o
   * formato do corpo: objeto para um, resumo com `results[]` para lote.
   */
  @Public()
  @Post('agent-contact')
  @HttpCode(200)
  agentContact(
    @Req() req: ApiKeyRequest,
    @Body(AgentContactBodyPipe) body: AgentContactBody,
  ) {
    return body.batch
      ? this.ingest.ingestAgentContacts(req.apiKey.accountId, body.rows)
      : this.ingest.ingestAgentContact(req.apiKey.accountId, body.rows[0]);
  }

  /**
   * Desfechos das ligações de uma lista, para o n8n devolver ao ERP.
   * `since` (ISO 8601) permite puxar só o que mudou desde a última execução.
   */
  @Public()
  @Get('operational-list/:listKey/outcomes')
  outcomes(
    @Req() req: ApiKeyRequest,
    @Param('listKey') listKey: string,
    @Query('since') since?: string,
  ) {
    return this.ingest.listOutcomes(req.apiKey.accountId, listKey, since);
  }
}
