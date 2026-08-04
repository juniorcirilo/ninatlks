import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookEndpointsController } from './webhook-endpoints.controller';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

/**
 * Webhooks de *envio* (produto → sistema do cliente): o cadastro dos destinos e
 * a entrega em si.
 *
 * Separado do WebhooksModule, que trata do que entra (Twilio, Meta, Evolution,
 * ElevenLabs), e do WebhookLogModule, que só lê o histórico de entregas.
 *
 * A fila é registrada aqui, e não no JobsModule com as outras: quem emite é o
 * VoiceModule, e o JobsModule já importa o VoiceModule — pendurar a fila lá
 * fecharia um ciclo entre módulos. `BullModule.forRoot` é global, então a
 * conexão configurada no JobsModule vale para esta fila também.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'webhook-delivery' })],
  controllers: [WebhookEndpointsController],
  providers: [
    WebhookEndpointsService,
    WebhookDispatchService,
    WebhookDeliveryProcessor,
  ],
  exports: [WebhookEndpointsService, WebhookDispatchService],
})
export class WebhookEndpointsModule {}
