// k6 load test: zernio-incoming webhook throughput.
//
// Simulates N virtual clients each posting a message.received payload
// every 3-5s. Measures edge function p95 latency + error rate.
//
// Usage (requires TEST_USER already logged-in scenario or ANON_KEY):
//   NEXUS_URL=https://... NEXUS_ANON_KEY=... k6 run messages-throughput.js

import http from 'k6/http';
import { check, sleep } from 'k6';

const NEXUS_URL = __ENV.NEXUS_URL;
const ANON_KEY = __ENV.NEXUS_ANON_KEY;

if (!NEXUS_URL || !ANON_KEY) {
  throw new Error('set NEXUS_URL and NEXUS_ANON_KEY env vars');
}

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

const SAMPLE_TEXTS = [
  'Oi, queria saber o preço da camiseta',
  'Vocês entregam em Florianópolis?',
  'Qual o tamanho pra 1,20m de altura?',
  'Tem desconto pra primeira compra?',
  'Quanto tempo leva a entrega?',
  'Aceita cartão de crédito?',
  'Tem a coleção Chavoso em preto?',
  'Quero falar com um atendente humano',
];

export default function () {
  const senderId = `test_${__VU}_${Math.random().toString(36).slice(2, 10)}`;
  const text = SAMPLE_TEXTS[Math.floor(Math.random() * SAMPLE_TEXTS.length)];

  const payload = JSON.stringify({
    event: 'message.received',
    id: `evt_${Date.now()}_${__VU}`,
    message: {
      id: `msg_${Date.now()}_${__VU}`,
      conversationId: `conv_load_${__VU}`,
      platform: 'instagram',
      platformMessageId: `pm_${Date.now()}_${__VU}_${__ITER}`,
      direction: 'incoming',
      text,
      attachments: [],
      sender: {
        id: senderId,
        name: `Bot VU${__VU}`,
        username: `bot_vu${__VU}`,
      },
      sentAt: new Date().toISOString(),
      isRead: false,
    },
    conversation: {
      id: `conv_load_${__VU}`,
      platform: 'instagram',
      participantId: senderId,
      participantName: `Bot VU${__VU}`,
    },
    account: {
      id: 'test',
      platform: 'instagram',
      username: 'ghmbarboza',
    },
    timestamp: new Date().toISOString(),
  });

  const res = http.post(`${NEXUS_URL}/functions/v1/zernio-incoming`, payload, {
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
    },
    tags: { name: 'zernio-incoming' },
  });

  check(res, {
    'status 200': (r) => r.status === 200,
    'under 2s': (r) => r.timings.duration < 2000,
  });

  sleep(Math.random() * 2 + 3);
}
