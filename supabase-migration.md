# Plano: substituir o Supabase por um backend próprio no `ninatlks`

## Contexto

O projeto `ninatlks` é um app TanStack Start (React + Bun) cujo **backend inteiro hoje é o Supabase**: banco Postgres com RLS multi-tenant, Auth, Storage, Realtime e — principalmente — **78 Edge Functions em Deno** (`supabase/functions/*`) que implementam toda a lógica de negócio (Twilio, ElevenLabs, WhatsApp/Evolution, Meta, disparo de campanhas, agendamento, GDPR/retenção, etc.), além de `pg_cron` para ~10 jobs periódicos. Não existe hoje nenhum servidor de aplicação próprio — `server.mjs` apenas serve os arquivos estáticos/SSR do build.

O objetivo é sair da dependência do Supabase e ter um backend autogerenciado, mantendo o comportamento atual (multi-tenancy, RLS, integrações com provedores externos, realtime na UI) com o menor risco possível, já que é um produto em produção com estado sensível (chamadas de voz ao vivo, CSAT, webhooks de provedores externos).

Decisões de arquitetura já validadas:
1. **Plataforma**: Node.js autogerenciado via Docker (reaproveitando `Dockerfile`/`docker-compose.yml` existentes), não Cloudflare Workers.
2. **Auth**: **better-auth** (biblioteca TS self-hosted, adapter Drizzle) no lugar do Supabase Auth.
3. **Banco**: Postgres autogerenciado via Docker + **Drizzle ORM**.
4. **Multi-tenancy**: **manter RLS no Postgres**, adaptando as policies (`is_account_member()`, `has_role()`) para ler de uma session variable setada pela API a partir da sessão do better-auth, em vez de `auth.uid()` do Supabase.

## Inventário do uso atual do Supabase

- **Clientes**: `src/integrations/supabase/client.ts` (browser, anon key), `client.server.ts` (admin, service role), `auth-middleware.ts` (middleware TanStack que valida JWT via `supabase.auth.getClaims`), `auth-attacher.ts` (anexa Bearer token nas chamadas de server-fn), `types.ts` (tipos gerados).
- **~50 arquivos** em `src/lib/*.ts` (contacts, calls, campaigns, meetings, pipeline, personas, voice, twilio, evolution, elevenlabs, notifications, attachments, `agents/*`) fazem CRUD via `supabase.from(...)` e chamam edge functions via `supabase.functions.invoke(...)`.
- **Banco**: `supabase/migrations/` — 142 arquivos, ~60 tabelas, praticamente todas com FK `account_id` (multi-tenant): `accounts`, `contacts`, `contact_lists/tags/inboxes/dossiers/facts`, `conversations`, `messages`, `conversation_outcomes/signals/checkpoints/replays`, `voice_calls`, `voice_campaigns`/`voice_campaign_contacts`, `agent_personas`/`agent_persona_deployments`/`samples`, `phone_numbers`, `inboxes`, `channels`, `doctors`/`doctor_availability`/`doctor_blocks`, `notifications`, `invites`, `workflows`/`workflow_events`/`workflow_runs`, `prompt_versions`/`prompt_deployments`, `eval_scenarios/runs/conversations`, `webhook_deliveries`, `account_secrets`, `csat_surveys`, `retention_rules`, `promise_followups`, `escalation_rules`, `live_sessions/live_takeovers`, `customer_memory_nodes/edges`, entre outras.
- **RLS**: policies via `is_account_member(auth.uid(), account_id)` e `has_role(auth.uid(), account_id, role)`, aplicadas em 24+ arquivos de migration.
- **pg_cron**: ~10 migrations agendam chamadas periódicas para edge functions (`cadence-tick`, `meeting-reminder-tick`, `meeting-noshow-tick`, `dispatch-retry`, `retention-detect-inactive`, `csat-auto-enroll`, etc).
- **Auth**: Supabase Auth padrão (`getSession/getUser/getClaims/onAuthStateChange/signOut`) via `src/lib/auth-context.tsx`; fluxo próprio de convite/onboarding em cima disso (`invites`, `admin-registro.tsx`, `auth.tsx`, `reset-password.tsx`).
- **Storage**: `src/lib/attachments.ts` (upload + signed URLs); edge functions `_shared/meta/media.ts`, `_shared/twilio/recordings.ts` (mídia/gravações), `media-cleanup/index.ts`.
- **Realtime**: `.channel()`/`postgres_changes` em `NotificationsBell.tsx`, `pipeline.tsx`, `campanhas.$campaignId.tsx`, `mission-control.tsx`, `chat.tsx`, `phone-numbers.tsx`.
- **Edge Functions**: 78 funções Deno em `supabase/functions/*/index.ts` — é o backend de fato hoje (Twilio SMS/voz, ElevenLabs, Evolution/WhatsApp, Meta, disparo de campanhas, classificação de leads, agendamento, GDPR/retenção, chat, dashboards, cron). Helpers compartilhados em `supabase/functions/_shared/` (auth, logger, webhook-security, secrets vault, clients de cada provedor).
- **Dependências**: único pacote backend-relevante no `package.json` é `@supabase/supabase-js`. Nenhum ORM, framework de servidor ou lib de JWT hoje.
- **Env vars atuais**: `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` — também **hardcoded** em `Dockerfile`/`docker-compose.yml` (vazamento de segredo a corrigir independentemente da migração).

## Arquitetura alvo

```
docker-compose.yml
├── postgres   (Postgres 16, substitui o Postgres do Supabase)
├── redis      (fila/agendamento de jobs)
├── minio      (storage S3-compatible, substitui Supabase Storage)
├── api        (novo serviço Node — Hono)
└── web        (existente — server.mjs, app TanStack Start)
```

- **API**: Hono (leve, TS-first, roda bem em Node puro e facilita portar as 78 funções como rotas HTTP organizadas por domínio).
- **Banco**: Postgres self-hosted + **Drizzle ORM** para schema/migrations, com RLS mantido via policies SQL.
- **Auth**: **better-auth** com adapter Drizzle; sessão em cookie httpOnly; a API seta `SET LOCAL app.current_user_id / app.current_account_id` em cada transação a partir da sessão validada, e as policies RLS passam a ler dessas session vars em vez de `auth.uid()`.
- **Storage**: **MinIO** (S3-compatible), URLs assinadas via SDK S3.
- **Realtime**: triggers Postgres com `pg_notify` nas tabelas hoje observadas via `postgres_changes` + um listener Node (`LISTEN`) que repassa para um servidor WebSocket próprio, filtrando por `account_id`.
- **Jobs/Cron**: **BullMQ + Redis**, substituindo `pg_cron` (jobs repetíveis com os mesmos cron schedules) e dando retry/backoff nativo para casos como `dispatch-retry`.
- **78 Edge Functions → rotas/route modules e workers** organizados por domínio, espelhando os arquivos hoje em `src/lib/*.ts`.

### Estrutura de diretórios nova (`server/`)

```
ninatlks/server/
  src/
    index.ts                  # entrypoint Hono
    db/
      schema/                 # schema Drizzle, um arquivo por domínio (accounts, contacts,
                               # conversations, voice, campaigns, personas, scheduling,
                               # workflows, evals, notifications, ...)
      client.ts                # cliente Drizzle + helper de session vars p/ RLS
      migrations/               # migrations geradas pelo drizzle-kit
    auth/
      better-auth.ts            # instância/config do better-auth
      middleware.ts              # verificação de sessão (Hono middleware)
    routes/
      contacts.ts, calls.ts, campaigns.ts, meetings.ts, pipeline.ts,
      personas.ts, voice.ts, notifications.ts, ...
      webhooks/
        twilio.ts, evolution.ts, meta.ts, elevenlabs.ts, resend-inbound.ts
      admin/
        invites.ts
    realtime/
      pg-listener.ts             # LISTEN nos canais pg_notify
      ws-server.ts                # broadcast para clientes conectados
    jobs/
      queue.ts                    # setup BullMQ
      processors/                 # um arquivo por job (cadence-tick, meeting-reminder-tick,
                                   # dispatch-retry, retention-detect-inactive, csat-auto-enroll,
                                   # media-cleanup, ...)
    storage/
      minio-client.ts, attachments.ts
    shared/                      # portado de supabase/functions/_shared
      twilio-client.ts, elevenlabs-client.ts, evolution-client.ts,
      meta-client.ts, secrets-vault.ts, webhook-security.ts, logger.ts
  package.json, tsconfig.json, Dockerfile
```

## Fases da migração (ordem pensada para reduzir risco)

### Fase 0 — Infraestrutura base
- Adicionar serviços `postgres`, `redis`, `minio` ao `docker-compose.yml`; criar serviço `api` (Hono) vazio, health-check.
- **Rotacionar imediatamente** as chaves do Supabase hoje hardcoded em `Dockerfile`/`docker-compose.yml` e migrar todos os segredos de provedores (Twilio/ElevenLabs/Evolution/Meta hoje na tabela `account_secrets`/`_shared/secrets/vault.ts`) para um vault próprio ou variáveis de ambiente do novo serviço.

### Fase 1 — Banco de dados e RLS
- Extrair schema + dados do Postgres do Supabase via `pg_dump` (Supabase É Postgres — dump direto, sem conversão de dados).
- Reproduzir no Postgres self-hosted; introspectar com `drizzle-kit` para gerar o schema Drizzle inicial a partir do dump (em vez de reescrever as 142 migrations à mão).
- Reescrever `is_account_member()` e `has_role()` para ler de `current_setting('app.current_user_id')`/`current_setting('app.current_account_id')` em vez de `auth.uid()`; validar as 24+ arquivos de policy RLS uma a uma contra o novo schema.
- Auditar as ~10 migrations de `pg_cron` para extrair os cron expressions exatos (serão reaproveitados no BullMQ na Fase 6).

### Fase 2 — Auth (better-auth)
- Subir better-auth com adapter Drizzle; migrar usuários de `auth.users` (Supabase) para o schema do better-auth.
- **Hashes de senha**: Supabase (GoTrue) usa bcrypt; better-auth usa scrypt por padrão, mas permite hook de verificação customizado — configurar verificação bcrypt para usuários legados com re-hash automático (scrypt) no próximo login bem-sucedido, evitando forçar reset de senha em massa.
- Substituir `src/integrations/supabase/auth-middleware.ts`, `auth-attacher.ts` e `auth-context.tsx` por equivalentes que falam com better-auth.
- Reimplementar o fluxo de convites (`invites` table, `admin-registro.tsx`) sobre a sessão do better-auth.

### Fase 3 — Camada de API (baixo risco primeiro)
- Criar `src/lib/api-client.ts` (fetch wrapper com cookie de sessão) para uso incremental.
- Migrar `src/lib/*.ts` um domínio por vez, mantendo as assinaturas das funções exportadas (só troca `supabase.from(...)` por chamadas HTTP à nova API) — isso limita o raio de impacto por arquivo e permite testar cada domínio isoladamente.
- Ordem sugerida: **personas, prompt-versions/eval-lab, notifications** (domínios mais isolados) → **contacts, pipeline, campaigns, meetings** (núcleo do produto, médio risco) → deixar **voice/calls e os webhooks de provedores para o final** (alto risco, estado ao vivo).

### Fase 4 — Storage (MinIO)
- Subir MinIO, migrar buckets/objetos do Supabase Storage.
- Substituir `src/lib/attachments.ts` e a geração de signed URLs em `_shared/meta/media.ts` / `_shared/twilio/recordings.ts` pelo SDK S3 apontando para o MinIO.

### Fase 5 — Realtime
- Criar triggers `pg_notify` nas tabelas hoje usadas com `postgres_changes`.
- Implementar `pg-listener.ts` + `ws-server.ts`; substituir os 6 usos de `.channel()` no frontend (`NotificationsBell.tsx`, `pipeline.tsx`, `campanhas.$campaignId.tsx`, `mission-control.tsx`, `chat.tsx`, `phone-numbers.tsx`) por um client WS próprio com a mesma interface de callback, minimizando mudanças na UI.

### Fase 6 — Cron / jobs em background
- Configurar BullMQ com os cron schedules extraídos na Fase 1.
- Portar a lógica de cada função de cron (`cadence-tick`, `meeting-reminder-tick`, `meeting-noshow-tick`, `dispatch-retry`, `retention-detect-inactive`, `csat-auto-enroll`, `media-cleanup`, etc.) de Deno para processors Node, preservando semântica de retry/erro.

### Fase 7 — Domínios de alto risco
- **Voice/calls (Twilio, ElevenLabs)**: portar com atenção especial a chamadas em andamento durante o cutover — planejar corte em janela de baixo tráfego, ou rodar em paralelo (dual-run) até confirmar paridade.
- **Webhooks externos** (Twilio, Meta, Evolution/WhatsApp, ElevenLabs, Resend): portar preservando exatamente a verificação de assinatura (`_shared/webhook-security.ts`); atualizar as URLs cadastradas nos dashboards dos provedores só depois de validar o novo endpoint em paralelo (ex.: manter proxy temporário do Supabase Edge Function para o novo endpoint durante a transição).
- **GDPR/retenção** (`retention_rules`, exportação/exclusão de dados): validar com casos de teste antes de desligar a versão Supabase.

### Fase 8 — Cutover e decomissionamento
- Confirmar paridade funcional domínio a domínio (checklist manual + logs comparativos).
- Apontar 100% do tráfego para o novo backend, desligar edge functions do Supabase, remover dependência `@supabase/supabase-js` do `package.json`.
- Manter o projeto Supabase como backup/rollback por um período antes de encerrar.

## Riscos principais
- Reescrita das policies RLS (24+ arquivos) é a peça mais delicada tecnicamente — erro aqui pode vazar dados entre contas (`account_id`).
- Portar 78 Edge Functions é o maior volume de trabalho — priorizar por domínio, não tentar big-bang.
- Estado de chamadas de voz ao vivo durante o corte (Twilio/ElevenLabs).
- Compatibilidade de hash de senha na migração de usuários (bcrypt → scrypt).
- Verificação de assinatura de webhooks (Twilio/Meta/Evolution/ElevenLabs) precisa continuar funcionando sem interrupção durante a transição.
- Segredos hoje hardcoded em `Dockerfile`/`docker-compose.yml` precisam ser rotacionados independentemente da migração.
