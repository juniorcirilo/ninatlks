# Utalks — Checklist de Go-Live pós-remix

Este projeto é uma plataforma omnichannel de atendimento com IA (voz + WhatsApp + Meta) construída no Lovable Cloud.

> **Estado atual**: banco virgem. Zero contas, zero usuários, zero dados. Pronto para o cliente fazer o 1º signup.

---

## 1. Conferir secrets em Lovable Cloud

Acesse **Connectors → Lovable Cloud → Secrets** e confirme que estes estão presentes (vêm do remix por padrão; rotacione antes de produção se quiser white-label puro):

### Voz / Telefonia
- `ELEVENLABS_API_KEY` — conta ElevenLabs (TTS + agentes conversacionais)
- `ELEVENLABS_WEBHOOK_SECRET` — segredo HMAC dos eventos
- `TWILIO_ACCOUNT_SID` — Twilio Account SID
- `TWILIO_AUTH_TOKEN` — Twilio Auth Token
- `DEEPGRAM_API_KEY` — transcrição

### WhatsApp
- `EVOLUTION_WEBHOOK_SECRET` — assinatura dos webhooks da Evolution API

### Meta (WhatsApp Cloud / Messenger / Instagram)
- `META_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `MESSENGER_PAGE_ACCESS_TOKEN`
- `MESSENGER_VERIFY_TOKEN`
- `INSTAGRAM_VERIFY_TOKEN`

### Email transacional
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (formato: `Nome <no-reply@dominio.com>`)

### Outros
- `WIDGET_TOKEN_SECRET` — assinatura JWT do widget público
- `ZERNIO_API_KEY` / `ZERNIO_WEBHOOK_SECRET` — integração Zernio

> **Não usados** neste projeto (ignorar): `ASAAS_API_KEY`, `ASAAS_API_URL`.

---

## 2. Configurar webhooks externos

Substitua `<PUBLISHED>` pela URL publicada do seu remix (ex.: `https://meu-projeto.lovable.app`).

| Provedor | Evento | URL |
|---|---|---|
| ElevenLabs | Conversation events | `<PUBLISHED>/functions/v1/elevenlabs-events` |
| Twilio | Voice incoming | `<PUBLISHED>/functions/v1/twilio-incoming` |
| Twilio | Recording callback | `<PUBLISHED>/functions/v1/twilio-recording-callback` |
| Twilio | SMS incoming | `<PUBLISHED>/functions/v1/twilio-sms-incoming` |
| Twilio | Call status | `<PUBLISHED>/functions/v1/twilio-status` |
| Evolution API | Webhook geral | `<PUBLISHED>/functions/v1/evolution-incoming` |
| Meta WhatsApp | Webhook messages | `<PUBLISHED>/functions/v1/meta-whatsapp` |
| Meta Messenger | Webhook | `<PUBLISHED>/functions/v1/meta-messenger` |
| Meta Instagram | Webhook | `<PUBLISHED>/functions/v1/meta-instagram` |

---

## 3. Primeiro signup → vira admin

1. Acesse `<PUBLISHED>/auth`
2. Cadastre o email do administrador (qualquer email — não há lista pré-aprovada).
3. O trigger `handle_new_user` automaticamente:
   - Cria o workspace único (`accounts.is_primary = true`)
   - Vincula o usuário como `admin`
   - Cria o registro `org_onboarding_state`
4. **A partir deste ponto, novos signups diretos são bloqueados.** Demais usuários só entram por convite.

---

## 4. Completar o onboarding (7 steps)

Ao fazer login pela 1ª vez como admin, o `OnboardingGate` abre o wizard:

1. **Boas-vindas**
2. **Empresa** — nome, fuso, indústria
3. **ElevenLabs** — confirmar credenciais + escolher voz
4. **Twilio** — confirmar credenciais
5. **Deepgram** — confirmar credencial de transcrição
6. **Evolution** — conectar instância WhatsApp (QR code)
7. **Agente IA** — criar persona inicial
8. **Primeiro número** — comprar/importar número Twilio

Pode pular e continuar depois pelo checklist persistente no canto inferior direito.

---

## 5. Convidar a equipe

- Acesse `/equipe` (visível só para admin).
- Clique em **Convidar membro** → escolha role (`admin`, `member`, `viewer`) → copie o link gerado.
- Envie o link ao convidado. Ao se cadastrar com o token, o usuário entra direto no workspace com a role definida.
- Convites expiram conforme regra padrão; podem ser revogados na mesma tela.

---

## 6. Cron jobs (já ativos)

| Job | Frequência | Função |
|---|---|---|
| `nexus-meeting-reminder-tick` | a cada 1 min | Lembretes T-15min de reuniões |
| `voice-calls-finalize-pending` | a cada 2 min | Recupera chamadas órfãs sem `ended_at` |
| `nexus-cadence-tick` | a cada 5 min | Avança cadências de follow-up |
| `nexus-meeting-noshow-tick` | a cada 5 min | Marca no-show e dispara follow-up |

Nada a fazer — rodam automaticamente.

---

## 7. Pós-go-live (recomendado)

- **Rotação de secrets**: se o remix herdou as credenciais Utalks, gere as próprias em ElevenLabs/Twilio/Deepgram/Evolution e atualize via Connectors → Lovable Cloud → Secrets.
- **RLS hardening**: rodar o linter de segurança em **Cloud → Security** e endereçar warnings de `SECURITY DEFINER` executáveis por anon e `search_path` mutável.
- **Domínio próprio**: conectar via **Project Settings → Domains** e atualizar todos os webhooks acima para o domínio final.

---

**Ready check final**: depois do passo 3, faça uma chamada de teste pelo botão "Nova chamada" em `/calls` para validar o pipeline ponta-a-ponta (Twilio → ElevenLabs → Deepgram → finalize → classificação).
