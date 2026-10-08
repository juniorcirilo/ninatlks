# Utalks — Cutover: Supabase → backend próprio (NestJS)

Este documento é o estado real da migração descrita em
`/home/neco/.claude/plans/crie-um-plano-para-virtual-dewdrop.md` (Fases 1-9) e
o runbook para o corte de tráfego final. Ele substitui `supabase-migration.md`
na raiz do repo, que descreve um plano anterior (Hono + Drizzle + better-auth)
**abandonado** em favor de NestJS + TypeORM + sessão opaca — mantenha o antigo
só como histórico, não siga suas instruções.

> **Não execute o corte de tráfego a partir deste documento sem revisão
> humana.** Ele é um checklist e um registro de estado, não uma autorização
> para desligar o Supabase. As seções 5-7 descrevem ações destrutivas/difíceis
> de reverter (mudar DNS/env de produção, decomissionar o projeto Supabase) —
> confirme cada uma com o time antes de rodar.

## 1. O que está pronto (backend NestJS em `server/`)

Testado module a module contra Postgres/Redis/MinIO reais deste repo
(`docker-compose.yml`) e, onde fazia sentido, contra APIs reais dos
provedores (Twilio, ElevenLabs, Evolution) para confirmar mapeamento de erro
correto — não apenas typecheck/build.

| Domínio | Módulo(s) | Observação |
|---|---|---|
| Infra | `TypeOrmModule`, Redis, MinIO | Fases 1-2 |
| Schema + RLS | 143 migrations portadas de `supabase/migrations/*.sql` via `scripts/db/generate-typeorm-migrations.mjs` | `is_account_member`/`has_role` reescritas para ler `current_setting('app.current_user_id')` em vez de `auth.uid()` |
| Auth | `AuthModule` | Sessão opaca em cookie httpOnly, tabela `sessions`, argon2 + fallback bcrypt legado |
| Contas/Convites/Time | `InvitesModule`, `TeamModule`, `SystemSettingsModule`, `AccountSettingsModule` | |
| Domínio de negócio | `PersonasModule`, `ContactsModule`, `PipelineModule`, `CampaignsModule`, `MeetingsModule` | |
| Storage | `StorageModule` | MinIO via `@aws-sdk/client-s3`, presigned URLs |
| Realtime | `RealtimeModule` | Socket.io + `@socket.io/redis-adapter` + `PgListenService` (LISTEN/NOTIFY) |
| Jobs/cron | `JobsModule` | BullMQ — ver tabela na seção 2 |
| GDPR/Segredos/Compliance | `GdprModule`, `SecretsModule`, `ComplianceModule` | |
| Provedores | `TwilioModule`, `EvolutionModule`, `ElevenLabsModule` | Clientes REST + resolução de credenciais (Vault → env fallback) |
| Webhooks públicos | `WebhooksModule` | Twilio (incoming/sms/status/recording-status), Evolution (incoming, com secret-header — o original não tinha auth nenhuma), Meta (data-deletion), ElevenLabs (events/personalization) |
| Voz | `VoiceModule` | Números, guard de discagem (DNC/horário/rate-limit), outbound Twilio-direto e EL-nativo, phone-register, voice-clone, **ConversationRelay** (relay de texto via `ws`, não streaming de áudio bruto), pipeline completo de finalização pós-chamada (transcript/áudio/sentimento/classificação), transcrição Deepgram (Twilio), resumo IA sob demanda, cancel/reclassify de chamada |
| Agentes ElevenLabs | `ElevenLabsModule` | Voices/preview + sync de persona↔agente EL, kb-add, agent-info, proxy de áudio de chamada |
| Calls (histórico) | `CallsModule` | Leitura only, join com contato |
| `agent-tools` | `AgentToolsModule` | As 5 tools de function-calling que o agente de voz chama durante a ligação (confirm/get-availability/qualify-lead/reschedule/schedule-meeting) |
| Mensagens | `MessagesModule` | `chat-send-message` (operador manda WhatsApp manual) — sem UI própria ainda no frontend |
| Cadências/Webhook log/Onboarding/Status | `CadencesModule`, `WebhookLogModule`, `OnboardingModule`, `IntegrationsStatusModule` | |
| Dashboards | `DashboardsModule` | SDR snapshot, Mission Control, Agent Analytics |

Todos os `src/lib/*.ts` do frontend com call sites reais foram reapontados
para a nova API (`apiClient`, sessão via cookie `credentials: "include"`), com
exceção documentada na seção 3.

### Bugs reais encontrados e corrigidos durante o port (não presentes no
Supabase original, ou mascarados lá por causa de RLS/superuser diferentes)

Todos documentados inline em `KNOWN_FIXES` em
`scripts/db/generate-typeorm-migrations.mjs` (nunca tocam
`supabase/migrations/*.sql` originais) ou como comentários no código do
`server/`:

- `merge_contacts()` referenciava `avatar_url` (coluna nunca existiu) e tinha
  ordem de operações que violava unique constraint.
- `lgpd_delete_contact()`, `set_account_secret()`, `delete_account_secret()`,
  `tg_trigger_auto_reply()`, `save_app_settings()`, `mark_arrangement_paid()`
  — todas inseriam em `audit_log` sem popular `entity_type` (NOT NULL),
  disparando 500 em runtime real.
- `contacts.service.ts`'s `importCsv` usava `ON CONFLICT (account_id,
  phone_number)` — constraint que não existe; o real é `(account_id,
  identifier) WHERE identifier IS NOT NULL`.
- Webhook inbound (SMS/WhatsApp) upsertava `contact_inboxes` com
  `ON CONFLICT (contact_id, inbox_id)` — também não existe; o real é
  `UNIQUE(inbox_id, source_id)`. Todo webhook teria falhado com 42P10.
- `tg_message_update_contact()` fazia `JOIN channels ON channels.inbox_id =
  conversations.inbox_id` — `channels` não tem essa coluna (FK é o inverso,
  `inboxes.channel_id`). **Toda inserção de mensagem falhava** (SMS e
  WhatsApp inbound ficavam mudos) até este fix.
- `evolution-incoming` original não validava nenhuma assinatura — qualquer
  request externo podia forjar mensagens inbound. Fixed com header
  `x-nina-webhook-secret` verificado via `timingSafeEqual`.
- `VoiceElOutboundService`: lançar exceção depois de já ter escrito a row em
  `voice_calls` fazia rollback da transação por request (`TenantTxHost`),
  enquanto `call_attempts_log` (escrito via `DataSource` direto, fora da
  transação) sobrevivia — ficava um `voice_call_id` órfão no log de auditoria.
  Corrigido para retornar resultado estruturado em vez de lançar, uma vez que
  o estado já foi persistido.
- `tg_voice_call_update_contact()` (trigger AFTER INSERT/UPDATE em
  `voice_calls`) fazia `operational_status = COALESCE(v_new_op::public.
  operational_status, operational_status)` — esse tipo nunca existiu no
  schema; o enum real é `contact_operational_status`. Postgres resolve o
  tipo do cast em parse time independente do valor, então **todo**
  insert/update de `voice_calls` com `conversation_id` preenchido quebrava
  com erro fatal, não um no-op silencioso. Achado testando os fixes da
  seção 4.4 (nunca tinha sido exercitado antes por causa do próprio gap de
  RLS descrito lá). Corrigido em
  `migrations/20260720260000-FixVoiceCallContactTrigger.ts`.
- `conversation_outcomes.source` é `varchar(20)`, mas `'lead-classify-from-call'`
  (`call-classification.service.ts`) e `'agent-tool-qualify-lead'`
  (`agent-tools.service.ts`) têm 24 caracteres — todo insert nesses dois
  caminhos quebrava com "value too long for type character varying(20)".
  Achado do mesmo jeito (só ficou alcançável depois do fix da seção 4.4).
  Corrigido alargando a coluna pra `varchar(40)` (mesma largura de
  `outcome_type` na mesma tabela) em
  `migrations/20260720270000-WidenConversationOutcomesSource.ts`.

## 2. Cron jobs — mapeamento `pg_cron` → BullMQ

| Job original | Schedule | Status |
|---|---|---|
| `media-cleanup` | diário 03:10 | ✅ portado |
| `rate-limit-alert` | */10min | ✅ portado |
| `nexus-meeting-reminder-tick` | */1min | ✅ portado, testado contra API real (401 tratado) |
| `nexus-meeting-noshow-tick` | */5min | ✅ portado, testado |
| `nexus-cadence-tick` | */5min | ✅ portado (só `channel=voice`, igual ao original — WhatsApp/email nunca foram implementados lá) |
| `voice-campaign-dispatch` | */1min | ✅ portado, guard de compliance confirmado bloqueando corretamente |
| `voice-calls-finalize-pending-2m` | */2min | ✅ portado e **RLS-fechado** (`VoiceCallFinalizePendingProcessor`) — pega calls EL travadas >90s e refaz a passada de reclassificação de nome. Ver seção 4.4: as 2 queries de scan do próprio processor eram a peça que faltava — sem elas o pipeline de 20260720170000 nunca era alcançado de verdade |
| `dispatch-retry` | */5min | ❌ **não portado** — única dependência (`channels-send`) não existe mais no repo (função removida/renomeada em algum ponto anterior a esta migração; não é uma lacuna introduzida aqui) |
| `templates-sync`, `memory-extract-tick`, `signals-detect-tick`, `snooze-wakeup-tick`, `improvement-tick`, `messages-retention`, `workflow-execute`, `workflow-cron-tick`, `crm-sync-worker` | vário | ❌ órfãos — apontam pra edge functions que não existem no repo há algum tempo |
| `debtors-auto-sync-6h` | 6h | ❌ fora de escopo — chama um app Lovable diferente |
| `voice-campaign-dispatch-every-minute` | */1min | ❌ duplicata com URL hardcoded do projeto Supabase antigo — não portado (o `voice-campaign-dispatch` acima já cobre a função real) |

**Antes de decomissionar o Supabase**: rode `select jobname, schedule, active
from cron.job;` no Postgres de produção real para confirmar que essa lista
bate — este inventário foi inferido só de `supabase/migrations/*.sql`, o
plano original já sinalizava essa checagem como obrigatória e ela nunca foi
feita porque não havia acesso ao projeto de produção real durante o
desenvolvimento.

## 3. O que **não** foi portado (gaps conhecidos, deliberados)

- **`twilio-conversation-relay`**: foi portado (ver `ConversationRelayService`)
  — não é mais um gap.
- **`agent-tool-*`** (confirm-meeting, get-availability, qualify-lead,
  reschedule-meeting, schedule-meeting): **portado** (`AgentToolsModule`,
  rotas `POST /agent-tools/{confirm-meeting,get-availability,qualify-lead,
  reschedule-meeting,schedule-meeting}`, guard de secret compartilhado
  `x-el-webhook-secret` = `ELEVENLABS_WEBHOOK_SECRET`, igual ao original) —
  boot-testado ponta a ponta contra Postgres real (auth 401 sem secret,
  todas as 5 rotas, conflito de agenda, cancel/reschedule, e o insert em
  `dnc_list`). Dois bugs pré-existentes do código original Deno foram
  corrigidos na porta, não apenas replicados:
  1. `agent-tool-qualify-lead` escrevia o `sentimento` em PT-BR
     (positivo/neutro/negativo) direto em `contacts.last_sentiment`, mas essa
     coluna tem `CHECK` que só aceita `positive/neutral/negative` — todo
     `qualify-lead` com sentimento preenchido (campo obrigatório) quebrava
     com 500 em produção. Corrigido com um mapeamento PT→EN antes do
     `UPDATE` (`mapSentiment` em `agent-tools.service.ts`).
  2. O mesmo function também escrevia a `OutcomeCategory` interna
     (`scheduled`/`qualified`/`callback`/...) direto em
     `voice_calls.outcome_category`, mas o `CHECK` dessa coluna usa outro
     vocabulário (`interested`/`callback_requested`/...) — outro 500
     garantido pra `fase_pipeline` em `qualificado`, `proposta` ou
     `demo_agendada`. Corrigido com `OUTCOME_CATEGORY_DB_MAP`.
  **Passo manual pendente, fora do escopo desta porta**: reconfigurar as
  tools de function-calling no agente ElevenLabs (URLs hoje apontam pra
  `*.supabase.co/functions/v1/agent-tool-*`) para apontar pra
  `<PUBLIC_API_URL>/agent-tools/*` e enviar o mesmo `x-el-webhook-secret`.
  Isso é feito no painel/API do ElevenLabs, não no código — não presumir
  feito.
- **Pipeline de finalização pós-chamada**: `elevenlabs-events` (webhook),
  `voice-call-finalize` (orquestrador), `lead-classify-from-call`,
  `sentiment-analyze` e o cron `voice-calls-finalize-pending` — **portados**
  como uma unidade coesa (`ElevenLabsWebhooksController` em
  `POST /webhooks/elevenlabs/events`, `CallFinalizeService`,
  `CallClassificationService`, `CallSentimentService`,
  `VoiceCallFinalizePendingProcessor` em `modules/voice/` e
  `modules/jobs/processors/`). Ao contrário do original (que encadeava tudo
  via loopback HTTP entre edge functions com bearer de service-role), aqui
  os serviços se chamam diretamente em processo — mesmo padrão já usado por
  `VoiceElOutboundService`/`VoiceOutboundService`. Boot-testado contra
  Postgres real: `CallSentimentService`/`CallClassificationService`
  instanciados diretamente (sem HTTP, já que não têm rota pública — só são
  chamados internamente) contra fixtures reais, confirmando fallback léxico
  de sentimento, heurística regex de classificação (incluindo a limitação
  conhecida do original de só capturar o primeiro match do regex de nome —
  replicada fielmente), auto-move de stage, e todos os `UPDATE`/`INSERT`
  esperados; webhook testado ponta a ponta (assinatura HMAC válida e
  inválida, resolução de `voice_calls` por `source_id`, invocação do
  finalize). Não foi possível testar o *fetch* real contra a API do
  ElevenLabs (exigiria uma API key real) — o caminho "sem key configurada"
  (503 interno, absorvido pelo webhook que sempre responde 200) foi
  verificado.
- **Outros ElevenLabs — `elevenlabs-agent-sync`, `elevenlabs-agent-info`,
  `elevenlabs-kb-add`, `elevenlabs-call-audio`, `elevenlabs-personalization`**:
  **portados** (`ElevenLabsAgentService` + rotas em `ElevenLabsController`
  para os 4 primeiros — `POST .../agent-sync`, `GET .../agent-info/:agentId`,
  `POST .../kb-add`, `POST .../call-audio`, todos sob
  `accounts/:accountId/elevenlabs/`, guardados por sessão como o resto do
  módulo; `elevenlabs-personalization` como webhook público em
  `POST /webhooks/elevenlabs/personalization`, auth por `x-el-webhook-secret`
  igual ao original). `agent-sync` reaponta as URLs das `agent-tool-*`
  tools e dos webhooks de evento/personalização para
  `<PUBLIC_API_URL>/agent-tools/*` e `<PUBLIC_API_URL>/webhooks/elevenlabs/*`
  em vez das antigas `*.supabase.co/functions/v1/*` — critério de aceite
  automático (5 evaluation criteria), tool schemas e o guardrail de usar
  **`conversation_config` (singular)** no payload da API EL foram replicados
  fielmente (o comentário original documenta um bug histórico com
  `conversational_config`, chave inválida que a EL descartava
  silenciosamente). `elevenlabs-kb-add` tinha uma inconsistência no original
  (lia `ELEVENLABS_API_KEY` só de env global, não do Vault por conta, ao
  contrário de todas as outras 5 funções) — **corrigido** na porta pra usar
  `ElevenLabsConfigService.loadAccountCreds` como as demais, já que o modelo
  multi-tenant claramente pede isso. Boot-testado contra Postgres real:
  `elevenlabs-personalization` ponta a ponta (cenário inbound com contato
  existente, reunião futura, empresa — enriquecimento completo verificado
  campo a campo; cenário outbound com `dynamic_variables` do dispatcher
  vencendo o enriquecimento, `agent_name` sempre vindo da persona); as 4
  rotas autenticadas confirmadas atrás do guard de sessão (401 sem cookie);
  os dois ramos de `call-audio` (redirect pra `recording_url` legado do
  Twilio vs. 404 sem gravação disponível) confirmados via estado real no
  banco. Chamadas reais à API do ElevenLabs (agent create/patch, KB upload)
  não puderam ser testadas nesta sessão (exigem API key real).
- **Meta** (WhatsApp Cloud/Messenger/Instagram nativos): `_shared/meta/*`
  confirmado como código morto (zero imports em qualquer function ativa) —
  não portado de propósito. Só `meta-data-deletion` (compliance obrigatório)
  foi portado.
- **`dispatch-retry`**: ver seção 2.
- **`chat-send-message`**: portado no backend (`MessagesModule`), mas não há
  UI de Live Chat "enviar mensagem" no frontend atual que o chame — capacidade
  pronta, sem consumidor ainda.
- **`contact-export`, `recent-activity`, `platform-health`**: auditados em
  2026-07-20 — **confirmados código morto, não portados de propósito**.
  Nenhum tem call site alcançável no frontend hoje: o export de contatos que
  existe (`central.tsx`) é 100% client-side (`contactsToCsv`/`downloadCsv`
  em `src/lib/central.ts`) e nunca chamou essa function; o botão
  "Exportar" em `contacts.tsx` está desabilitado; "atividade recente" é
  servida por `DashboardsController` (`mission-control`/`sdr-snapshot`), não
  por `recent-activity`; não existe rota/página consumindo
  `platform-health` (há um comentário de migration mencionando uma UI de
  saúde da plataforma que aparentemente nunca foi construída — substituída
  por `admin-filas.tsx` via `admin-queues.functions.ts`). `rate-limit-alert`
  (o job cron) foi portado normalmente.
- **`twilio-recording-callback` + `transcribe-voice`**: **portados**
  (`CallTranscriptionService` em `modules/voice/`, webhook
  `POST /webhooks/twilio/recording-status` no `TwilioWebhooksController`,
  retry manual em `POST /accounts/:accountId/voice/calls/:id/transcribe`).
  Caminho de transcrição Deepgram só para calls via Twilio — calls
  ElevenLabs já saem transcritas do `voice-call-finalize` (seção acima) e
  nunca passam por aqui. Recording é habilitado estaticamente no console da
  Twilio (não via TwiML — confirmado que o código original também nunca
  seta `RecordingStatusCallback` programaticamente); **passo manual
  pendente**: apontar essa config no console da Twilio pra
  `<PUBLIC_API_URL>/webhooks/twilio/recording-status`, mesma natureza do
  caveat já registrado para os `agent-tool-*`. Boot-testado diretamente
  contra Postgres real: sem `DEEPGRAM_API_KEY` configurada (503, antes de
  qualquer leitura da call — igual ao original), sem `recording_storage_path`
  (400), sem credenciais Twilio pra conta (`persistAndTranscribe` absorve o
  erro e retorna sem exceção, sem corromper a row). Frontend reapontado:
  `src/lib/twilio.ts#retryTranscription` e o botão em `phone-numbers.tsx`
  saíram do `supabase.functions.invoke` direto pro novo endpoint.
- **`call-summary-generate`**: **portado** (`CallSummaryService`, rota
  `POST /accounts/:accountId/voice/calls/:id/summary`). O código original
  tinha **dois bugs** que o deixavam sempre quebrado: o frontend
  (`calls.tsx`) enviava `{call_id}` mas a function esperava
  `{voice_call_id}` (sempre 400), e o frontend lia `data.summary` mas a
  function retornava `ai_summary` (resumo gerado nunca aparecia mesmo nos
  casos em que a request funcionasse). Ambos corrigidos na porta — o botão
  "Gerar/Regenerar resumo" em `calls.tsx` foi reapontado pro novo endpoint
  com os nomes de campo corretos. Boot-testado: sem `LOVABLE_API_KEY` (500),
  cache hit quando `ai_summary` já setado e `force=false` (skip, sem chamada
  externa).
- **`voice-campaign-export`**: **portado**
  (`CampaignsService.exportCsv`, rota `POST /accounts/:accountId/campaigns/:id/export`,
  resposta `text/csv` com BOM UTF-8 igual ao original). Boot-testado com
  sessão real: CSV gerado corretamente com join de `voice_campaign_contacts`
  + `contacts` + `voice_calls`.
- **`voice-call-cancel`**: **portado** (`CallOpsService.cancel`, rotas
  `POST /accounts/:accountId/voice/calls/:id/cancel` e
  `POST /accounts/:accountId/campaigns/:id/cancel-calls` — este último
  distinto de `PATCH .../status`, que só troca o status da campanha sem
  tocar `voice_calls`/`voice_campaign_contacts`). Dois bugs do original
  corrigidos: (1) usava credenciais Twilio globais (`TWILIO_ACCOUNT_SID`/
  `TWILIO_AUTH_TOKEN` de env) em vez de credenciais por conta via Vault,
  inconsistente com todo o resto do sistema multi-tenant — corrigido pra
  `TwilioConfigService.loadAccountCreds`; (2) o branch de
  `campaign_id` sem nenhuma call ainda despachada retornava cedo **sem
  checar se o usuário é membro da conta** — como as rotas aqui já nascem
  aninhadas em `accounts/:accountId/...` com `AccountMemberGuard`, esse gap
  não existe mais estruturalmente. Boot-testado com sessão real: cancelamento
  de call avulsa (sem credenciais Twilio/EL configuradas — pula
  silenciosamente esses passos, mantém o `UPDATE` de status, igual ao
  original) e cancelamento de campanha inteira (confirma que o contact ainda
  não despachado E o já despachado terminam `canceled`).
- **`voice-reclassify`**: **portado** (`CallOpsService.reclassify`, rota
  `POST /accounts/:accountId/voice/calls/:id/reclassify`, `@Roles('admin')` —
  mapeia 1:1 pro `user_roles` check manual do original). Heurística regex +
  fallback LLM (Lovable AI Gateway) replicados fielmente, incluindo o upsert
  em `dnc_list` quando a categoria vira `do_not_call`. Boot-testado com
  sessão real (usuário admin): heurística "me tira da lista" classificada
  corretamente como `do_not_call`, `voice_calls.outcome_*` atualizado, linha
  inserida em `dnc_list`.
- **`voice-escalate`**: **não portado, deliberadamente**. Diferente das
  outras 4 desta seção, não há NENHUM caller real no repo inteiro (nem
  frontend, nem outra edge function) — o próprio código original é uma
  função órfã, presumivelmente pensada pra ser chamada por um
  "voice-runtime" externo que não está neste repositório. Tinha auth por
  bearer de service-role (não sessão de usuário) e dois problemas
  identificados na leitura: lia `p_campaign_id` do metadata da call em vez
  da própria linha de `voice_campaign_contacts`, e o insert em
  `live_takeovers` não bate com o schema atual (`account_id`/`voice_call_id`
  não existem na tabela portada) — já era um insert best-effort/engolido no
  original, então isso já era inofensivo lá. Mesmo tratamento do
  `dispatch-retry`: não inventar uma rota nova pra uma função sem consumidor
  conhecido.
- **`prompts.ts`, `voice-routing.functions.ts`** (frontend): confirmado como
  código morto (zero call sites) — não portados de propósito.

## 4. Pré-requisitos antes de cogitar o corte

1. **Rodar `select * from cron.job` em produção** (seção 2) e reconciliar.
2. ✅ **Gaps da seção 3 decididos** — `dispatch-retry`/`voice-escalate`
   (sem consumidor real) e `contact-export`/`recent-activity`/
   `platform-health` (auditados em 2026-07-20, confirmados código morto)
   ficam deliberadamente não portados. Nada bloqueando o corte por aqui.
3. **Migrar dados**: `pg_dump` do Postgres do Supabase → restore no Postgres
   próprio (schema já é idêntico, migrations foram portadas 1:1 + os fixes da
   seção 1). Objetos do Supabase Storage → MinIO via `mc mirror` (bucket
   `attachments`, gravações de voz, mídia de mensagens).
4. **Migrar `auth.users` (GoTrue) → tabela `sessions`/`profiles`**, mantendo
   o UUID de cada usuário (referenciado por FK em ~60 tabelas). Rehash de
   senha é automático no primeiro login pós-corte (bcrypt legado → argon2).
5. ✅ **Testes de isolamento de RLS** — feito em dev local em 2026-07-20,
   com achados críticos corrigidos (ver seção 4.1 abaixo). Falta repetir
   contra o Postgres de staging/produção antes do corte real.
6. ✅ **Realtime com 2 réplicas** — feito em dev local em 2026-07-20 (2
   instâncias NestJS separadas, mesma infra Postgres/Redis/MinIO
   compartilhada, sem Docker scale — ver seção 4.1). Continua valendo
   repetir com `docker-compose up --scale ninatlks=2` antes de produção,
   já que hoje `docker-compose.yml` roda web+api no mesmo container com
   `container_name`/portas fixas, incompatível com `--scale` sem um
   override temporário.
7. ✅ **RLS no domínio `voice/`** — feito em dev local em 2026-07-20, o
   gap deixado aberto em 4.2 (ver seção 4.4). `MediaCleanupProcessor`
   continua em aberto (mesmo gap, generic SQL dinâmico precisa de
   allowlist antes de virar `SECURITY DEFINER`).

### 4.1. Achados críticos da rodada de testes de RLS (2026-07-20)

**O produto é single-tenant, não multi-tenant** — `enforce_single_account()`
(`supabase/migrations/20260429105445_...sql`, decisão de negócio original,
não introduzida por esta migração) impede criar uma segunda linha em
`accounts`. O teste de "isolamento entre 2 contas" descrito no item 5 acima
não se aplica a este deployment: só existe (e só pode existir) 1 workspace.
O que importa isolar é visibilidade **por papel** (admin vs. agent) dentro
dessa única conta — os testes abaixo focaram nisso.

Três problemas reais foram encontrados e corrigidos ao testar com o papel de
app do Postgres sem privilégio de superusuário (como será em produção — até
agora só tinha sido testado com um usuário superuser, que ignora RLS
silenciosamente independente de policy, exatamente o risco que a seção de
riscos deste plano já apontava):

1. **Papel de app do Postgres era superusuário** — RLS nunca esteve
   realmente em vigor em nenhum teste anterior. Corrigido: criado role
   dedicado sem `BYPASSRLS`/superuser, `FORCE ROW LEVEL SECURITY` em todas
   as tabelas com RLS habilitado, grants mínimos por schema.
2. **`profiles`/`account_users`/`user_roles` têm RLS keyed em `auth.uid()`,
   mas login, `/auth/me`, os Guards (`AccountMemberGuard`/`RolesGuard`) e o
   handshake do WebSocket (`RealtimeGateway.handleConnection`) rodam **fora**
   do `TenantTxHost` por design (não há contexto de tenant ainda —
   estabelecer esse contexto é literalmente o trabalho desses guards) — toda
   consulta nesses pontos via repositório simples retornava zero linhas sob
   RLS real. Corrigido com funções `SECURITY DEFINER` estreitas e auditáveis
   (migrations `20260720100000-PreAuthRlsBypass.ts` e
   `20260720110000-RealtimeMembershipBypass.ts`) só para esses call sites
   específicos — RLS continua em vigor normalmente para tudo que passa pelo
   `TenantTxHost`.
3. **A causa raiz real, encontrada por último**: todas as policies portadas
   (24+ arquivos) são `TO authenticated` — papel padrão do
   Supabase/PostgREST, presente no dump mas nunca concedido ao role de app
   do NestJS. Sem essa concessão, **nenhuma** policy se aplica ao role da
   app (RLS habilitado + forçado + zero policy aplicável = negação total),
   o que explica por que o teste de isolamento "passava" antes — não porque
   a checagem de membership funcionasse, mas porque tudo era negado
   incondicionalmente, inclusive para membros legítimos (confirmado: um
   INSERT de um admin real na própria conta falhava com
   `new row violates row-level security policy`). Corrigido com
   `GRANT authenticated TO ninatlks_app;`
   (`20260720120000-AppRoleAuthenticatedMembership.ts`). Depois desse fix,
   confirmado empiricamente: membro real consegue inserir/ver dado da
   própria conta: sessão sem membership ou sem sessão nenhuma continua
   vendo zero linhas.
4. **Bugs menores encontrados no caminho** (branch antes não exercitado sob
   RLS real): `password_reset_tokens` não tinha migration nenhuma (entidade
   existia, tabela não); `AuthModule` não registrava
   `PasswordResetToken` em `TypeOrmModule.forFeature`; `auth.service.ts`
   deletava token de reset por `row.id` mas a PK real é `row.userId`. Os
   três corrigidos.
5. **`.env` local também não tinha `S3_ENDPOINT`/`S3_ACCESS_KEY`/
   `S3_SECRET_KEY`/`S3_ATTACHMENTS_BUCKET`** (só as credenciais root do
   MinIO existiam, que não são as que `env.validation.ts` exige) — a app
   nunca teria conseguido subir via `docker-compose` como estava. Criado um
   MinIO access key dedicado (não-root), com policy restrita ao bucket
   `attachments` (mesmo raciocínio de least-privilege do role Postgres).
   Efeito colateral esperado, não um bug: `StorageService.onModuleInit`
   tenta `CreateBucketCommand` no boot como "garantir que existe" — com essa
   credencial restrita isso agora falha com Access Denied (logado como
   warn, não derruba o boot). Bucket já existe e todas as operações reais
   (`PutObject`/`GetObject`/`DeleteObject`/`ListBucket`) funcionam; criação
   de bucket é responsabilidade de provisionamento de infra, não da app em
   runtime — decisão deliberada, não pendência.

**Varredura adicional** (grep literal por `@InjectRepository` fora de
`common/`/`database/` — o próprio comentário do `TenantTxHost` já pedia essa
checagem em CI, nunca tinha sido rodada): achou mais 2 problemas reais,
corrigidos:

- `SystemSettingsController.update` (PATCH, autenticado) injetava
  `Profiles`/`SystemSettings` direto do pool default em vez de
  `TenantTxHost.manager` — a checagem de super-admin e o próprio UPDATE
  dependiam de `auth.uid()`, nunca setado nessa conexão. Corrigido pra usar
  `TenantTxHost` como qualquer módulo tenant-aware (`GET` continua com
  injeção direta, de propósito — é `@Public()`, a policy de leitura é
  `USING (true)` pro role `authenticated`, não depende de `auth.uid()`).
- `AuthService.acceptInvite` buscava o convite por token via repositório
  simples — `invites` só permite `SELECT` pra admin da conta
  (`has_role(auth.uid(), account_id, 'admin')`), mas quem está aceitando um
  convite ainda não é membro, muito menos admin. Mesma correção das outras
  (`auth_get_invite_by_token`,
  `migrations/20260720130000-InviteAcceptBypass.ts`).

Ao testar esse fluxo ponta a ponta pela primeira vez (só foi possível depois
dos fixes de RLS acima — antes disso nunca tinha rodado de verdade),
apareceu um terceiro problema, sem relação com RLS: o `handle_new_user()`
**live neste banco de dev** não batia com nenhuma migration rastreada —
tinha a lógica de bootstrap de super-admin (`is_super_admin`) mas tinha
perdido os branches de convite/toggle-de-registro/join-no-workspace-primário
que `supabase/migrations/20260430194150_...sql` define. Efeito: todo
accept-invite tentava criar uma conta nova e batia no
`enforce_single_account()`. Drift de ambiente (dev), não bug de migration —
provavelmente um patch manual direto no banco em alguma sessão anterior que
nunca virou migration. Corrigido restaurando a função combinando os dois
comportamentos (`migrations/20260720140000-FixHandleNewUser.ts`) e validado
ponta a ponta: convite aceito entra na conta certa, com o role certo,
`invites.accepted_at` preenchido, `is_super_admin=false` (primeiro usuário
via `register()` continua `is_super_admin=true`, testado antes).

**Teste de realtime com 2 réplicas**: 2 processos NestJS locais (portas
distintas) apontando pra mesma infra compartilhada, cada um com seu próprio
`PgListenService`/conexão Redis. Cliente Socket.io conectado à réplica A e
outro à réplica B, ambos autenticados via cookie de sessão real; um
`POST /accounts/:id/contacts` disparado contra a réplica B chegou como
`app_change` nos dois sockets. Observação de arquitetura: como cada réplica
já tem sua própria conexão `LISTEN` direta ao Postgres (não passa por uma
réplica "líder" só), o fan-out do `@socket.io/redis-adapter` não é hoje o
mecanismo que entrega esse evento entre réplicas — cada uma já recebe o
`NOTIFY` independentemente e faz seu próprio `broadcast()` local. O adapter
está corretamente configurado e é necessário para outras operações
cross-instância do Socket.io (`fetchSockets()`, disconnect remoto), mas não
foi isolado como estritamente necessário para *este* caminho de entrega
específico — não chega a ser um problema, só um detalhe que vale registrar
caso o design do broadcast mude no futuro (ex.: se algum código passar a
emitir direto sem passar pelo `NOTIFY`, aí sim dependeria do adapter).

### 4.2. Mesmo problema, achado em jobs BullMQ (2026-07-20)

Grep por `this.dataSource.query`/`getRepository` fora de `common/`/
`database/` (mesma varredura da 4.1, escopo mais amplo). A maioria dos
processors cross-conta já segue o padrão certo — passa por função
`SECURITY DEFINER` (`cadence_due`/`cadence_advance`,
`meeting_reminder_due`/`meeting_noshow_due`, etc.), então já funciona sob
RLS real. Achados 3 que não seguiam o padrão:

- **`RateLimitAlertProcessor`** — acessava `channel_usage_metrics`/
  `user_roles`/`notifications` direto. **Corrigido** — toda a lógica do
  tick (scan, dedupe, insert) virou uma função `SECURITY DEFINER` só
  (`rate_limit_alert_tick`, `migrations/20260720150000-JobsCrossAccountBypass.ts`).
  Validado ponta a ponta com dado real semeado: métrica de uso 95% →
  notificação criada pro admin da conta, via o role de app com RLS real.
- **`VoiceCallFinalizePendingProcessor`** — ✅ **corrigido** (2026-07-20, ver
  seção 4.4). Esta nota ficou obsoleta: na época dizia "não corrigido, de
  propósito" porque as duas queries de scan do processor E o resto do
  módulo `voice/` (finalize, classify, sentiment, summary, transcription,
  personalization, relay, twilio-voice, credenciais) tinham o mesmo gap.
  Isso motivou uma passada completa e deliberada pelo domínio inteiro — ver
  seção 4.4 para o detalhamento migration a migration e a verificação
  ponta a ponta contra RLS real.
- **`MediaCleanupProcessor`** — **não corrigido**. Mesmo gap, mas
  parametrizado por tabela/coluna através de várias tabelas não
  relacionadas (`memory_extraction_state`, `csat_surveys`,
  `channel_usage_metrics`, `webhook_deliveries`, gravações no MinIO) — uma
  função `SECURITY DEFINER` genérica de SQL dinâmico aqui precisa de
  allowlist de identificadores, mais cuidado do que o padrão copy-paste
  usado nos outros. **Prático**: limpeza automática de dados antigos
  simplesmente não roda hoje (sem erro visível), o que é inofensivo a curto
  prazo mas acumula dado que deveria ter sido expirado.

### 4.3. Mensageria inbound (SMS + WhatsApp) — mesmo gap, corrigido (2026-07-20)

Continuando a mesma varredura pros webhook receivers: `TwilioSmsService` e
`EvolutionWebhooksService` (WhatsApp) funilam pra `InboundMessageService.
ingest()`, uma transação de 6 passos (`inboxes`/`contacts`/
`contact_inboxes`/`conversations`/`messages`, todas RLS-forçadas) via pool
direto — mesmo problema dos outros achados: webhook não é "alguém",
`auth.uid()` nunca é setado. Sob RLS real isso derrubava silenciosamente
**toda mensagem SMS/WhatsApp inbound** (o webhook responde 200 pro
provedor normalmente, a mensagem simplesmente nunca é gravada). Diferente
de `voice/`, esse pipeline é CRUD puro e autocontido, sem chamada a API
externa nem estado de chamada ao vivo — **corrigido por completo**
(`migrations/20260720160000-InboundMessagingBypass.ts`): a busca de canal
por número/instância, o opt-out/opt-in de SMS, e a transação inteira de
ingest viraram funções `SECURITY DEFINER`. Validado ponta a ponta batendo
no endpoint HTTP real (`POST /webhooks/twilio/sms-incoming` com
`WEBHOOK_VERIFY_DISABLED=1`, sem sessão nenhuma) — mensagem chegou
corretamente em `messages` com o `account_id` certo.

`TwilioVoiceService` tem o padrão idêntico mas foi propositalmente deixado
de fora — está dentro do domínio `voice/` já sinalizado na seção 4.2, não
foi misturado com este fix de mensageria.

**Recomendação**: antes do corte, decidir com o time se `voice/` e
`MediaCleanupProcessor` recebem o mesmo tratamento (função por query,
seguindo o padrão já estabelecido) ou uma solução mais ampla (ex.: um role
Postgres dedicado a jobs, com `BYPASSRLS`, usado só pela conexão do
`worker` — nunca pela conexão que atende requests HTTP). O `service_role`
já existe no banco (`Cannot login, Bypass RLS`, herdado do dump do
Supabase) e não está em uso por ninguém hoje — candidato natural pra essa
segunda opção, mas exigiria uma conexão TypeORM separada só pro `worker`,
não a mesma `DataSource` global que a API usa.

### 4.4. Voz — passada completa de RLS (2026-07-20)

Fechou o gap deixado aberto em 4.2/4.3: **todo** o domínio `voice/` (9
arquivos: `VoiceCallFinalizePendingProcessor`, `elevenlabs-creds.util.ts`,
`twilio-creds.util.ts`, `CallTranscriptionService`,
`CallPersonalizationService`, `ConversationRelayService`,
`VoiceGuardService.logAttempt`, `TwilioVoiceService`,
`el-outbound-cron.util.ts`) foi auditado e corrigido, não só o pipeline de
finalize/classify/sentiment/summary já coberto por 20260720170000.

**Achado central antes de começar**: 20260720170000 já cobria o
pipeline pós-chamada com 24 funções `SECURITY DEFINER`, e o código de
`CallFinalizeService`/`CallClassificationService`/`CallSentimentService`/
`CallSummaryService` já as chamava — mas o **próprio**
`VoiceCallFinalizePendingProcessor` nunca tinha sido atualizado pra usá-las:
suas 2 queries de scan continuavam raw contra `voice_calls`, retornando
sempre zero linhas sob RLS real. Resultado prático: `finalize()`/
`classify()` nunca eram chamados pelo único job que existe pra chamá-los —
todo aquele trabalho já feito em 20260720170000 estava morto por falta de
uma porta de entrada. Esse foi o primeiro fix (20260720180000).

Migrations desta passada, em ordem:

| Migration | Cobre | Observação |
|---|---|---|
| `20260720180000-VoiceCallFinalizePendingFrontDoor` | as 2 queries de scan do processor | reusa `voice_call_update_metadata` de 20260720170000 pro passo de stamp |
| `20260720190000-AccountSecretsResolveBypass` | `account_secrets`/`vault.decrypted_secrets` | função única (`account_secret_resolve_bundle`) usada por `elevenlabs-creds.util.ts`, `twilio-creds.util.ts` **e** a cópia duplicada em `el-outbound-cron.util.ts` — as 3 sempre devolviam zero credenciais sob RLS real, mesmo quando a conta tinha segredo configurado |
| `20260720200000-CallTranscriptionBypass` | `CallTranscriptionService` (recording-callback + transcribe-voice) | 6 funções — lookup por `provider_call_sid`, persist de gravação (SET dinâmico da versão original preservado via `COALESCE`), get/set de status de transcrição |
| `20260720210000-CallPersonalizationBypass` | `CallPersonalizationService` (webhook EL, único call site) | 4 funções, consolidando os 7 SELECTs originais (`personalization_get_contact_context` junta contato+contagem de conversas abertas+briefing do dossiê+score num só round-trip) |
| `20260720220000-ConversationRelayBypass` | `ConversationRelayService` (WS puro, fora do pipeline HTTP do Nest — nunca teve `TenantTxHost`) | reusa `voice_call_get` de 20260720170000; achou e corrigiu um bug **não relacionado a RLS** — ver abaixo |
| `20260720230000-CallAttemptsLogInsertBypass` | `VoiceGuardService.logAttempt` | `call_attempts_log` não tem policy de INSERT pra nenhum role — o comentário original ("bypassa RLS via DataSource, igual o service-role do original") estava desatualizado: o role de app aqui não é BYPASSRLS, então esse insert falhava com erro de policy (não um no-op silencioso) |
| `20260720240000-TwilioVoiceIngestBypass` | `TwilioVoiceService` (`incoming`/`status`, upstream de tudo) | achou 2 bugs de cast enum (`direction`/`status`) só visíveis rodando a migration de verdade — `text` implícito não casa com enum em parâmetro de função SQL |
| `20260720250000-OutboundDialCronBypass` | `el-outbound-cron.util.ts` (resto, além das credenciais) — usado por `cadence-tick`/`meeting-reminder-tick`/`meeting-noshow-tick` | esses 3 crons estavam documentados como "✅ portado, testado" na seção 2, mas o discador de fato (resolver telefone/persona, criar/atualizar `voice_calls`) tinha o mesmo gap — nunca tinha sido exercitado sob RLS real antes |
| `20260720260000-FixVoiceCallContactTrigger` | bug pré-existente, não-RLS (ver seção 1) | `tg_voice_call_update_contact()` castava pra um enum que não existe — sem `down()` de propósito |
| `20260720270000-WidenConversationOutcomesSource` | bug pré-existente, não-RLS (ver seção 1) | `conversation_outcomes.source` varchar(20) curto demais pra 2 valores literais reais |

**Bug de `ConversationRelayService` não relacionado a RLS**: as duas
funções de insert em `messages` (transcript do cliente e resposta do
agente) nunca preenchiam `inbox_id` — coluna `NOT NULL` sem default nem
trigger que a popule. Isso já quebrava no código Deno original também (a
função foi portada fielmente do bug), então o transcript ao vivo nunca foi
persistido em `messages` por essa via, mesmo antes desta migração. Corrigido
fazendo as funções `relay_insert_contact_message`/`relay_insert_agent_message`
resolverem `inbox_id` a partir de `conversations.inbox_id` internamente
(por isso são `plpgsql`, não `sql` puro).

**Verificação**: nada disso foi só typecheck. Sequência usada —

1. `npx tsc --noEmit` limpo em `server/`.
2. Seed de dados reais (conta única existente + telefone, persona, contato,
   conversa, dossiê, `company_settings`, reunião futura, 3 `voice_calls` em
   estados diferentes, segredos EL/Twilio via `vault.secrets`).
3. Todas as ~29 funções novas chamadas diretamente via `psql` **como o role
   `ninatlks_app`** (não superusuário, sem nenhuma session var setada —
   exatamente a condição de um job/webhook real), confirmando (a) que uma
   query raw nas mesmas tabelas continua retornando zero linhas
   (`call_attempts_log` inclusive continua bloqueada pra SELECT — só o
   INSERT foi liberado, no escopo certo) e (b) que cada função devolve o
   dado real esperado.
4. 2 round-trips HTTP reais contra a API rodando: `POST
   /webhooks/elevenlabs/personalization` (sem secret configurado, guard
   pulado de propósito) devolveu prompt/variáveis corretos com o contexto
   do contato semeado; os jobs BullMQ reais rodaram no processo vivo da
   app (`voice-call-finalize-pending` pegou a call travada e a candidata a
   reclassificação, `CallClassificationService` classificou de verdade) —
   foi essa execução real que revelou os 2 bugs pré-existentes da seção 1.
5. Dados de teste removidos do banco ao final; app reiniciada e confirmada
   saudável (`/system-settings` e `/` respondendo 200).

**O que continua em aberto** (não coberto nesta passada): `MediaCleanupProcessor`
(mesmo gap, precisa de allowlist de identificador por ser SQL dinâmico
genérico — ver 4.2) e a checagem de `select * from cron.job` em produção
real (seção 4, item 1) — inferido só de migrations até hoje.

## 5. Runbook de corte (rascunho — revisar com o time antes de executar)

1. Rodar a API nova (`server/`) e o `worker` em paralelo ao Supabase, sem
   tráfego de produção ainda (dual-run).
2. Reconfigurar os webhooks dos provedores para apontar pra API nova, **um
   provedor por vez**, em janela de baixo tráfego:
   - Twilio Voice/SMS/Status → `<PUBLIC_API_URL>/webhooks/twilio/{incoming,sms-incoming,status}`
   - Evolution → `<PUBLIC_API_URL>/webhooks/evolution/incoming` (instância
     precisa ser reprovisionada via `EvolutionService.provision`, que já seta
     o header de secret)
   - Meta Data Deletion → `<PUBLIC_API_URL>/webhooks/meta/data-deletion`
3. Apontar o frontend (`VITE_API_URL`) pra API nova.
4. Confirmar métricas de erro/latência estáveis por pelo menos um ciclo
   completo de negócio (ex.: 24-48h) antes do próximo passo.
5. Só então: desligar as edge functions do Supabase (não apagar o projeto —
   manter como rollback frio por um período, conforme o plano original já
   recomendava).
6. Remover `@supabase/supabase-js` do frontend depois que **nenhum** arquivo
   em `src/lib/*.ts` ainda importar `@/integrations/supabase/client` (rodar
   `grep -rl "integrations/supabase/client" src/lib` pra confirmar —
   `listas.tsx` e alguns fluxos de import CSV ainda chamam Supabase
   diretamente conforme notas anteriores desta migração).

## 6. Rollback

Enquanto o projeto Supabase não for decomissionado, reverter é: apontar
`VITE_API_URL` de volta pro Supabase e reconfigurar os webhooks dos
provedores de volta pras URLs antigas (`*.supabase.co/functions/v1/*`). Por
isso a seção 5 recomenda manter o projeto Supabase vivo por um tempo após o
corte.

## 7. Decomissionamento final

Só depois de um período de operação estável 100% no backend novo:
- Remover `@supabase/supabase-js` do `package.json`.
- Apagar `src/integrations/supabase/` (client, client.server, auth-middleware,
  auth-attacher, types).
- Desligar o projeto Supabase.
- Arquivar `supabase/functions/*` e `supabase/migrations/*` (não apagar — são
  a fonte de verdade histórica de toda a lógica de negócio original, útil
  como referência mesmo depois do corte).
