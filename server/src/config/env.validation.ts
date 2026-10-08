import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  S3_ENDPOINT: z.string().min(1, 'S3_ENDPOINT is required'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY is required'),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_ATTACHMENTS_BUCKET: z.string().default('attachments'),

  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 24 * 30),

  // Publicly reachable base URL for this API — used to build provider
  // webhook callback URLs (Twilio voice/SMS/status, Meta, Evolution).
  PUBLIC_API_URL: z.string().default('http://localhost:3001'),

  // Pasta raiz das sessões WhatsApp (Baileys): <dir>/<channelId>/{auth,storage}.
  WA_SESSIONS_DIR: z.string().default('/data/sessions'),
  WA_LOG_LEVEL: z.string().default('silent'),

  // OpenCode CLI (agente de IA do atendimento — fala com o provedor
  // compatível com a API da OpenAI que a conta configurar).
  OPENCODE_WORKSPACE_DIR: z.string().default('/data/opencode'),
  OPENCODE_BIN: z.string().default('opencode'),
  OPENCODE_TIMEOUT_MS: z.coerce.number().default(90000),
  OPENCODE_RUN_UID: z.coerce.number().default(1000),

  // Serviço próprio de STT/TTS (/srv/containers/tts-stt). Sem STT_URL, desligado.
  STT_URL: z.string().optional(),
  STT_API_KEY: z.string().optional(),
  STT_LANGUAGE: z.string().default('pt'),
  TTS_VOICE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }
  return parsed.data;
}
