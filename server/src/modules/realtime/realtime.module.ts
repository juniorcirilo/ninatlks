import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { PgListenService } from './pg-listen.service';

@Module({
  imports: [AuthModule],
  providers: [RealtimeGateway, PgListenService],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
