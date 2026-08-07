import { Module } from '@nestjs/common';
import { SecretsModule } from '../secrets/secrets.module';
import { N8nModule } from '../n8n/n8n.module';
import { AgentContactBodyPipe } from './agent-contact-body.pipe';
import { AgentSourcesController } from './agent-sources.controller';
import { AgentSourcesService } from './agent-sources.service';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

/**
 * Ingestão de dados de sistema externo (ERP via n8n, auto-hospedado ou Cloud).
 *
 * Três superfícies no mesmo módulo, de propósito — são as portas de entrada de
 * dados e a administração delas:
 *  - `/ingest/*` — chamada pela máquina, autenticada por chave de API,
 *    @Public() em relação ao SessionAuthGuard;
 *  - `/accounts/:accountId/api-keys` — administração dessas chaves pela UI,
 *    com sessão, RLS e restrita a admin;
 *  - `/accounts/:accountId/agent-sources` — o caminho inverso: em vez de
 *    esperar o push, buscamos no sistema do cliente e traduzimos a resposta
 *    dele. Grava pelo mesmo IngestService, então as duas portas se comportam
 *    igual.
 *
 * `N8nModule` entra aqui (e não no módulo de settings) porque quem consome
 * `N8nIntegrationService` é o `AgentSourcesController` — é o clique em
 * "Configurar" de uma fonte que dispara a criação do nó no n8n.
 */
@Module({
  imports: [SecretsModule, N8nModule],
  controllers: [IngestController, ApiKeysController, AgentSourcesController],
  providers: [
    IngestService,
    ApiKeysService,
    ApiKeyGuard,
    AgentContactBodyPipe,
    AgentSourcesService,
  ],
  exports: [AgentSourcesService],
})
export class IngestModule {}
