# Teste de carga — Nexus

Objetivo: descobrir os limites reais do stack antes de abrir pra
cliente com volume. Foco em 3 métricas:

1. **Latência por turno** de voz (cliente pára de falar → IA começa
   a responder). Meta: p95 < 1.5s.
2. **Throughput de mensagens** no omnichannel. Meta: 100 msgs/min
   sem perda.
3. **Concorrência de ligações** por campanha. Meta: 20 simultâneas
   sem degradar.

Ferramentas: **k6** (scripts em `docs/testing/k6/`) + Supabase Edge
Logs + ElevenLabs dashboard.

---

## Preparação

```bash
# Install k6
brew install k6   # macOS
# OR
curl https://github.com/grafana/k6/releases/download/v1.3.0/k6-v1.3.0-linux-amd64.tar.gz | tar xz
```

Variáveis de ambiente que os scripts leem:

```bash
export NEXUS_URL="https://rjcgdesoiujrvtsjrgdy.supabase.co"
export NEXUS_ANON_KEY="eyJhbGciOiJI..."   # anon key pra auth
export TEST_USER_EMAIL="operador@teste.com"
export TEST_USER_PASSWORD="..."
export TEST_AGENT_ID="agent_5301kpvvvmehe0w8z8dkv48e63rm"
export TEST_PHONE_NUMBER_ID="phnum_..."
```

⚠️ **Use um tenant/número dedicado pra teste** — cenário de carga
pode queimar saldo Twilio + chars ElevenLabs rápido.

---

## Cenário 1 — Throughput de mensagens

Arquivo: `docs/testing/k6/messages-throughput.js` (abaixo)

Gera tráfego simulando webhooks do Zernio chegando no
`zernio-incoming`. Cada "cliente virtual" manda 1 DM a cada 3-5s, o
que dispara `persona-auto-reply` → `channels-send` → EL agent (ou
Gemini via gateway Lovable).

**Metas:**
- 100 virtual users durante 5 min
- Latência p95 do `zernio-incoming` < 2s
- Taxa de erro < 1%

**Como rodar:**
```bash
k6 run --vus 100 --duration 5m docs/testing/k6/messages-throughput.js
```

**Pontos de falha esperados:**
- Supabase edge function concurrency (tier free: 50 req simultâneas)
- Rate limit do Lovable AI Gateway
- Lock contention em `agent_personas` se muitos lookups simultâneos

---

## Cenário 2 — Concorrência de ligações em campanha

**Setup:** campanha com 20 números verificados (repita o seu se
necessário).

**Execução:**
1. Cria campanha no `/voice-campaigns` via UI com 20 contatos.
2. Antes de clicar "Iniciar", abre dashboard da EL em
   `elevenlabs.io/app/conversational-ai` → aba Conversations.
3. Clica Iniciar no Nexus.
4. Monitora:
   - Quantas ligações entram em `ringing` simultaneamente (cap
     default 5 — vê `voice-campaign-dispatch` DEFAULT_CONCURRENT_PER_CAMPAIGN).
   - Quanto tempo leva pra 20 terminarem.
   - Se ElevenLabs rejeita alguma (plano pode limitar concurrent
     agents).
5. Depois de terminar, confere em `voice_calls`:
   - Quantas tem `status: completed`
   - Quantas tem `transcript` populado
   - Se alguma tem `recording_url` OU `source_id` (pra gravação EL)

**Metas:**
- Todas as 20 tentadas (mesmo se algumas derem `no-answer`)
- Nenhuma erro 31921 (stream close)
- ≥ 80% com transcript após post_call webhook

**Se aumentar o cap:** editar `DEFAULT_CONCURRENT_PER_CAMPAIGN` no
`voice-campaign-dispatch/index.ts` pra 10 ou 20. Vê se EL dá rate
limit.

---

## Cenário 3 — Latência por turno de voz

Subjetivo mas crítico. Faça **3 ligações manuais** gravando cada uma:

1. Use cronômetro no celular.
2. Fala uma pergunta curta: "Quanto custa uma camiseta?"
3. Marca o momento que parou de falar + o momento que Nina começou a
   falar.
4. Repete 5 vezes em cada call.

Registra numa tabela:

| Call | p50 | p95 | max | Observação |
|------|-----|-----|-----|------------|
| 1    | 1.1s | 1.4s | 1.6s | sem ruído |
| 2    | ... | ... | ... | com ruído ambiente |
| 3    | ... | ... | ... | em movimento / celular ruim |

**Metas:**
- p50 ≤ 1.2s
- p95 ≤ 1.5s

**Se mais lento:** trocar `eleven_flash_v2_5` por `eleven_turbo_v2_5`
(TTS mais rápido, qualidade menor) OU reduzir `turn_timeout` em
`agent_personas.turn_config`.

---

## Cenário 4 — Teste de caos (opcional)

Simula falhas externas:

1. **ElevenLabs indisponível:** muda `ELEVENLABS_API_KEY` pra valor
   inválido temporariamente. Liga pro número. Observa:
   - Ligação cai com erro de TwiML? Ou fica em loop?
   - Aparece alerta no banner de alertas?
2. **Twilio sem saldo:** espera bater em <US$1 natural, ou testa
   com conta trial no fim do crédito.
3. **Supabase sem DB:** não dá pra simular sem risco. Pula.

---

## Script k6: messages-throughput.js

Arquivo: `docs/testing/k6/messages-throughput.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

const NEXUS_URL = __ENV.NEXUS_URL;
const ANON_KEY = __ENV.NEXUS_ANON_KEY;

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 100 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Simula payload Zernio entrando no webhook.
  const senderId = `test_${__VU}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = JSON.stringify({
    event: 'message.received',
    id: `evt_${Date.now()}_${__VU}`,
    message: {
      id: `msg_${Date.now()}`,
      conversationId: `conv_load_${__VU}`,
      platform: 'instagram',
      platformMessageId: `pm_${Date.now()}_${__VU}`,
      direction: 'incoming',
      text: 'Oi! Quero saber sobre o produto.',
      attachments: [],
      sender: { id: senderId, name: `Bot ${__VU}` },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: {
      id: `conv_load_${__VU}`,
      platform: 'instagram',
      participantId: senderId,
      participantName: `Bot ${__VU}`,
    },
    account: { id: 'test', platform: 'instagram', username: 'ghmbarboza' },
    timestamp: new Date().toISOString(),
  });

  const res = http.post(
    `${NEXUS_URL}/functions/v1/zernio-incoming`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
      },
    },
  );

  check(res, {
    '200 OK': (r) => r.status === 200,
    'under 2s': (r) => r.timings.duration < 2000,
  });

  sleep(Math.random() * 2 + 3); // 3-5s between messages
}
```

---

## Reporting

Ao final de cada cenário, documenta em
`docs/testing/LOAD_RESULTS_{YYYY-MM-DD}.md`:

```markdown
# Load test results — {date}

## Cenário 1 — Messages throughput
- VUs: 100 / Duration: 5m
- Total requests: N
- p50 / p95 / p99: Xms / Yms / Zms
- Error rate: N.NN%
- Bottleneck: <identificado>
- Fix sugerido: <...>

## Cenário 2 — Voice concurrency
- 20 ligações em 1 campanha
- Concurrent peak: N
- Sucesso: N/20 completed, M/20 connected
- Tempo total: X min
- Custo: Twilio $Y + ElevenLabs $Z

## Cenário 3 — Turn latency
- (tabela acima)
```

Commit esse arquivo no repo pra ter histórico entre testes.

---

## Ordem recomendada

1. **Setup** + T0 do E2E (garantir que tudo está no ar)
2. **Cenário 3** primeiro (baixo custo, alta relevância UX)
3. **Cenário 2** (gasta saldo real — atenção)
4. **Cenário 1** (pode rodar sem consumir saldo EL/Twilio se
   disabilar `persona-auto-reply` temporariamente)

Total estimado: 2-3h + US$10-30 de custo externo dependendo do
volume do cenário 2.
