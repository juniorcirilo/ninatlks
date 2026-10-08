import type { Server as HttpServer } from 'node:http';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { webOrigin } from './common/cors-origin.util';
import { AppModule } from './app.module';
import { RealtimeIoAdapter } from './realtime-io.adapter';
import { ProviderErrorFilter } from './common/filters/provider-error.filter';
import { ConversationRelayService } from './modules/voice/conversation-relay.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Atrás do nginx: req.ip / req.protocol vêm do X-Forwarded-* (rate limit por IP).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  // CORP liberado: mídia/anexos servidos pela API são embutidos pela web.
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: webOrigin(),
    credentials: true,
  });
  app.enableShutdownHooks();
  app.useGlobalFilters(
    new ProviderErrorFilter(app.get(HttpAdapterHost).httpAdapter),
  );

  const redisIoAdapter = new RealtimeIoAdapter(app);
  await redisIoAdapter.connectToRedis(process.env.REDIS_URL!);
  app.useWebSocketAdapter(redisIoAdapter);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  // Raw `ws` server for Twilio <ConversationRelay>, attached directly to the
  // HTTP server rather than through Nest's WS adapter (which is already
  // bound to Socket.io above) — see ConversationRelayService for why the two
  // coexist safely on the same 'upgrade' event.
  app.get(ConversationRelayService).attach(app.getHttpServer() as HttpServer);
}
void bootstrap();
