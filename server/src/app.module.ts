import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { typeOrmDataSourceOptions } from './config/typeorm.config';
import { redisConfig } from './config/redis.config';
import { s3Config } from './config/s3.config';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { CommonModule } from './common/common.module';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { InvitesModule } from './modules/accounts/invites/invites.module';
import { TeamModule } from './modules/accounts/team/team.module';
import { SystemSettingsModule } from './modules/accounts/system-settings/system-settings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PersonasModule } from './modules/personas/personas.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { StorageModule } from './modules/storage/storage.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { GdprModule } from './modules/gdpr/gdpr.module';
import { SecretsModule } from './modules/secrets/secrets.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { AccountSettingsModule } from './modules/account-settings/account-settings.module';
import { TwilioModule } from './modules/twilio/twilio.module';
import { EvolutionModule } from './modules/evolution/evolution.module';
import { ElevenLabsModule } from './modules/elevenlabs/elevenlabs.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { VoiceModule } from './modules/voice/voice.module';
import { CallsModule } from './modules/calls/calls.module';
import { MessagesModule } from './modules/messages/messages.module';
import { CadencesModule } from './modules/cadences/cadences.module';
import { WebhookLogModule } from './modules/webhook-log/webhook-log.module';
import { WebhookEndpointsModule } from './modules/webhook-endpoints/webhook-endpoints.module';
import { IntegrationsStatusModule } from './modules/integrations-status/integrations-status.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { AgentToolsModule } from './modules/agent-tools/agent-tools.module';
import { IngestModule } from './modules/ingest/ingest.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [redisConfig, s3Config],
    }),
    TypeOrmModule.forRoot(typeOrmDataSourceOptions),
    CommonModule,
    AuthModule,
    InvitesModule,
    TeamModule,
    SystemSettingsModule,
    NotificationsModule,
    PersonasModule,
    ContactsModule,
    PipelineModule,
    CampaignsModule,
    MeetingsModule,
    StorageModule,
    RealtimeModule,
    JobsModule,
    GdprModule,
    SecretsModule,
    ComplianceModule,
    AccountSettingsModule,
    TwilioModule,
    EvolutionModule,
    ElevenLabsModule,
    WebhooksModule,
    VoiceModule,
    CallsModule,
    MessagesModule,
    CadencesModule,
    WebhookLogModule,
    WebhookEndpointsModule,
    IntegrationsStatusModule,
    OnboardingModule,
    DashboardsModule,
    AgentToolsModule,
    IngestModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Auth by default; opt out per-route with @Public() (health checks,
    // login/invite-accept, provider webhooks authenticated by signature).
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
