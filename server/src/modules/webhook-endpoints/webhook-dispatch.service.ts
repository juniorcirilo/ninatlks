import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { WEBHOOK_EVENTS, type WebhookEvent } from './webhook-endpoints.service';

export interface WebhookDeliveryJob {
  deliveryId: string;
  accountId: string;
  endpointId: string;
  endpointName: string;
  url: string;
  secret: string;
  event: WebhookEvent;
  body: string;
}

/**
 * Ponta de emissão dos webhooks de envio: resolve os destinos assinantes e
 * enfileira uma entrega por destino.
 *
 * DataSource direto, e não TenantTxHost: quem emite é o fim de uma ligação ou
 * um processor de fila, onde não existe requisição nem `auth.uid()`. A tabela
 * tem RLS sem FORCE justamente para este caminho funcionar (ver
 * WebhookOutboundDispatch20260730230000).
 *
 * Fila em vez de POST inline porque destino fora do ar é o caso normal, não a
 * exceção: com fila a entrega é retentada sozinha e nada disso segura o
 * pós-chamada, que é o caminho crítico do produto.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('webhook-delivery') private readonly queue: Queue,
  ) {}

  /**
   * Nunca lança: um destino mal configurado não pode derrubar a operação que
   * gerou o evento. Falha vira log — e, quando a entrega chega a ser
   * tentada, linha em webhook_deliveries.
   *
   * `agentId`: quando o evento nasce de um agente específico (ex.: fim de
   * ligação carrega `persona_id`), passa aqui pra também disparar os destinos
   * amarrados àquele agente — além dos globais (`agent_id is null`), que
   * continuam recebendo tudo. Sem `agentId`, só os destinos globais disparam.
   */
  async emit(
    accountId: string,
    event: WebhookEvent,
    data: Record<string, unknown>,
    opts: { agentId?: string | null } = {},
  ): Promise<{ queued: number }> {
    try {
      if (!WEBHOOK_EVENTS.includes(event)) {
        this.logger.warn(`evento desconhecido ignorado: ${event}`);
        return { queued: 0 };
      }

      const endpoints = await this.dataSource.query<
        { id: string; name: string; url: string; secret: string }[]
      >(
        // `events = '{}'` é "assina tudo" — o default de quem cadastrou sem
        // querer entender o catálogo antes de testar. `agent_id is null`
        // sempre entra (destino global); `agent_id = $3` só entra quando o
        // evento veio de um agente identificado.
        `SELECT id, name, url, secret
           FROM public.account_webhook_endpoints
          WHERE account_id = $1
            AND active
            AND (cardinality(events) = 0 OR $2 = ANY(events))
            AND (agent_id IS NULL OR agent_id = $3)`,
        [accountId, event, opts.agentId ?? null],
      );
      if (endpoints.length === 0) return { queued: 0 };

      for (const endpoint of endpoints) {
        const deliveryId = randomUUID();
        // Corpo serializado aqui, uma vez: é ele que vai ser assinado, e
        // reserializar no processor arriscaria uma ordem de chaves diferente
        // da que foi assinada.
        const body = JSON.stringify({
          id: deliveryId,
          event,
          account_id: accountId,
          occurred_at: new Date().toISOString(),
          data,
        });

        await this.queue.add(
          'deliver',
          {
            deliveryId,
            accountId,
            endpointId: endpoint.id,
            endpointName: endpoint.name,
            url: endpoint.url,
            secret: endpoint.secret,
            event,
            body,
          } satisfies WebhookDeliveryJob,
          {
            jobId: deliveryId,
            attempts: 5,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        );
      }

      this.logger.log(
        `evento ${event} account=${accountId} destinos=${endpoints.length}`,
      );
      return { queued: endpoints.length };
    } catch (err) {
      this.logger.error(
        `falha ao emitir ${event} para account=${accountId}: ${(err as Error).message}`,
      );
      return { queued: 0 };
    }
  }
}
