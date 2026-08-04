import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { createHmac } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { WebhookDeliveryJob } from './webhook-dispatch.service';

/** Destino lento não pode segurar um worker: corta em 10s. */
const TIMEOUT_MS = 10_000;

/** Só o começo do corpo vai para o log — o resto já está no destino. */
const PREVIEW_CHARS = 500;

/**
 * Entrega o webhook e registra o resultado em `webhook_deliveries`, que é o que
 * a aba Envio mostra em "Entregas recentes".
 *
 * Assinatura: `X-Nina-Signature: sha256=<hmac(secret, "<timestamp>.<corpo>")>`.
 * O timestamp entra no que é assinado para quem recebe conseguir recusar
 * replay — assinar só o corpo deixaria uma entrega válida para sempre.
 *
 * Erro faz o job falhar de propósito: é assim que o BullMQ aplica as tentativas
 * com backoff exponencial configuradas na emissão. Cada tentativa grava sua
 * própria linha, então "tentou 4 vezes e caiu" fica visível na tela em vez de
 * virar um silêncio.
 */
@Processor('webhook-delivery')
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<WebhookDeliveryJob>): Promise<{ status: number }> {
    const data = job.data;
    const attempt = job.attemptsMade + 1;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', data.secret)
      .update(`${timestamp}.${data.body}`)
      .digest('hex');

    const startedAt = Date.now();
    let status: number | null = null;
    let error: string | null = null;

    try {
      const res = await fetch(data.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NinaTalks-Webhook/1',
          'X-Nina-Event': data.event,
          'X-Nina-Delivery': data.deliveryId,
          'X-Nina-Timestamp': timestamp,
          'X-Nina-Signature': `sha256=${signature}`,
        },
        body: data.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      if (!res.ok) {
        // Corpo da resposta ajuda a diagnosticar ("workflow not active" do
        // n8n, por exemplo), mas não é confiável em tamanho.
        const text = await res.text().catch(() => '');
        error = `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
      }
    } catch (err) {
      error =
        (err as Error).name === 'TimeoutError'
          ? `timeout após ${TIMEOUT_MS}ms`
          : (err as Error).message;
    }

    const durationMs = Date.now() - startedAt;
    await this.log(data, { status, error, durationMs, attempt });

    if (error) {
      this.logger.warn(
        `entrega ${data.deliveryId} destino=${data.endpointName} tentativa=${attempt} falhou: ${error}`,
      );
      throw new Error(error);
    }

    this.logger.log(
      `entrega ${data.deliveryId} destino=${data.endpointName} ${status} em ${durationMs}ms`,
    );
    return { status: status! };
  }

  /**
   * O log nunca derruba a entrega: se gravar falhar, o webhook já saiu e
   * transformar isso em erro faria o destino receber o evento duas vezes.
   */
  private async log(
    data: WebhookDeliveryJob,
    result: {
      status: number | null;
      error: string | null;
      durationMs: number;
      attempt: number;
    },
  ): Promise<void> {
    try {
      await this.dataSource.query(
        `INSERT INTO public.webhook_deliveries
           (account_id, endpoint, direction, http_status, duration_ms,
            payload_preview, error, metadata)
         VALUES ($1, $2, 'outbound', $3, $4, $5, $6, $7::jsonb)`,
        [
          data.accountId,
          // A coluna é varchar(120) e URL de webhook costuma passar disso; o
          // nome do destino é o que a tela mostra mesmo.
          data.endpointName.slice(0, 120),
          result.status,
          result.durationMs,
          data.body.slice(0, PREVIEW_CHARS),
          result.error,
          JSON.stringify({
            delivery_id: data.deliveryId,
            endpoint_id: data.endpointId,
            event: data.event,
            attempt: result.attempt,
            url: data.url,
          }),
        ],
      );
    } catch (err) {
      this.logger.error(
        `falha ao registrar entrega ${data.deliveryId}: ${(err as Error).message}`,
      );
    }
  }
}
