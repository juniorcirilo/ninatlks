import { Module } from '@nestjs/common';
import { N8nClientService } from './n8n-client.service';
import { N8nIntegrationService } from './n8n-integration.service';
import { N8nWorkflowService } from './n8n-workflow.service';

/**
 * Integração com n8n: um workflow por conta (nome de `N8N_WORKFLOW_NAME`,
 * "Utalks" por padrão), com um nó Webhook por agente que tem fonte de dados
 * configurada (`N8nIntegrationService`), e a capacidade genérica de acrescentar
 * qualquer nó a um workflow existente sem tocar no resto (`N8nWorkflowService`).
 * `SecretsModule` é `@Global()`, então `SecretsService` chega em
 * `N8nClientService` sem precisar importar nada aqui.
 */
@Module({
  providers: [N8nClientService, N8nIntegrationService, N8nWorkflowService],
  exports: [N8nIntegrationService, N8nWorkflowService],
})
export class N8nModule {}
