import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EvolutionClientService } from '../evolution/evolution-client.service';
import {
  callChatCompletion,
  type ChatMessage,
} from '../../common/llm/providers';
import {
  LlmNotConfiguredError,
  resolveLlmConfig,
} from '../../common/llm/resolve-llm-config';

const CONTEXT_TURNS = 8;
const MIN_REPLY_GAP_SECONDS = 8;
const MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR = 30;
const MAX_TOKENS = 200;
const FALLBACK_MODEL = 'google/gemini-2.5-flash';
const FALLBACK_TEMPERATURE = 0.5;
const FALLBACK_SYSTEM_PROMPT = 'Você é um agente de cobrança humano e cordial.';

const SYSTEM_PROMPT_GUARDRAILS = `
INSTRUÇÕES OBRIGATÓRIAS:
- Responda em português do Brasil, em UMA mensagem curta (no máximo 2 frases).
- NUNCA use placeholders entre colchetes como [Nome do Cliente], [valor], [data], [Seu Nome], [Nome da Empresa]. Se você não tem o dado real, omita-o.
- NUNCA repita a saudação se já houver mensagens anteriores no histórico.
- Se a última mensagem do cliente estiver vazia ou for um placeholder como "[mensagem]", NÃO responda — retorne uma string vazia.
- Espere a resposta do cliente antes de avançar. Não envie várias perguntas seguidas.
`.trim();

const PLACEHOLDER_CONTENTS = new Set(['[mensagem]', '[mídia]']);
const RESIDUAL_PLACEHOLDER_RE =
  /\[(?:Nome do Cliente|Seu Nome|Nome da Empresa|valor|data|valor da dívida|data do vencimento|Valor do Débito)\]/gi;

interface AutoReplyContext {
  account_id: string;
  inbox_id: string;
  contact_id: string;
  contact_phone: string | null;
  contact_identifier: string | null;
  ai_autopilot_enabled: boolean;
  ai_paused: boolean;
  trigger_sender_type: string | null;
  trigger_content: string | null;
  persona_id: string | null;
  system_prompt: string | null;
  channel_config: {
    evolution_url?: string;
    evolution_api_key?: string;
    evolution_instance_name?: string;
  } | null;
  last_bot_reply_at: string | null;
  bot_replies_last_hour: number;
  recent_messages: { sender_type: string | null; content: string | null; created_at: string }[];
}

/**
 * Porta de supabase/functions/persona-auto-reply/index.ts — chamado
 * diretamente em processo por InboundMessageService.ingest() logo após o
 * insert da mensagem inbound (substitui o trigger Postgres
 * `trg_messages_auto_reply`, removido em
 * 20260807120000-DropLegacyAutoReplyTrigger.ts). Nunca lança — qualquer erro
 * aqui não pode derrubar a ingestão da mensagem original.
 */
@Injectable()
export class PersonaAutoReplyService {
  private readonly logger = new Logger(PersonaAutoReplyService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly evolutionClient: EvolutionClientService,
  ) {}

  async maybeReply(args: {
    conversationId: string;
    triggeringMessageId: string;
  }): Promise<void> {
    try {
      await this.run(args);
    } catch (err) {
      this.logger.error(
        `auto-reply failed for conversation=${args.conversationId}`,
        err as Error,
      );
    }
  }

  private async run(args: {
    conversationId: string;
    triggeringMessageId: string;
  }): Promise<void> {
    const [row] = await this.dataSource.query<{ persona_auto_reply_context: AutoReplyContext | null }[]>(
      `SELECT public.persona_auto_reply_context($1, $2) AS persona_auto_reply_context`,
      [args.conversationId, args.triggeringMessageId],
    );
    const ctx = row?.persona_auto_reply_context;
    if (!ctx) return;

    if (ctx.trigger_sender_type !== 'Contact') return;
    const triggerText = (ctx.trigger_content ?? '').trim();
    if (!triggerText || PLACEHOLDER_CONTENTS.has(triggerText)) return;

    if (ctx.ai_paused === true) return;
    if (ctx.ai_autopilot_enabled === false) return;
    if (!ctx.persona_id) return;

    const cfg = ctx.channel_config;
    if (!cfg?.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
      return;
    }

    // Rate limit: min gap entre respostas + teto por hora (anti-loop).
    if (ctx.last_bot_reply_at) {
      const gapMs = Date.now() - new Date(ctx.last_bot_reply_at).getTime();
      if (gapMs < MIN_REPLY_GAP_SECONDS * 1000) return;
    }
    if (ctx.bot_replies_last_hour >= MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR) {
      this.logger.warn(`hourly cap hit for conversation=${args.conversationId}`);
      return;
    }

    let targetNumber = ctx.contact_phone ?? '';
    if (!targetNumber && ctx.contact_identifier) {
      const m = /evolution:whatsapp:([^@:]+)/.exec(ctx.contact_identifier);
      if (m) targetNumber = m[1];
    }
    if (!targetNumber) return;

    const systemPrompt = `${ctx.system_prompt || FALLBACK_SYSTEM_PROMPT}\n\n${SYSTEM_PROMPT_GUARDRAILS}`;
    const history: ChatMessage[] = ctx.recent_messages
      .filter((m) => m.content && !PLACEHOLDER_CONTENTS.has(m.content.trim()))
      .slice(-CONTEXT_TURNS)
      .map((m) => ({
        role: m.sender_type === 'Contact' ? 'user' : 'assistant',
        content: m.content as string,
      }));

    let reply: string;
    try {
      const llmConfig = await resolveLlmConfig(
        this.dataSource,
        ctx.account_id,
        FALLBACK_MODEL,
        FALLBACK_TEMPERATURE,
      );
      reply = await callChatCompletion({
        provider: llmConfig.provider,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        maxTokens: MAX_TOKENS,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
      });
    } catch (err) {
      if (err instanceof LlmNotConfiguredError) return;
      this.logger.error('llm call failed', err as Error);
      return;
    }

    reply = reply.replace(RESIDUAL_PLACEHOLDER_RE, '').trim();
    if (!reply) return;

    const messageId = await this.insertReply(ctx, args.conversationId, reply);
    if (!messageId) return;

    try {
      await this.evolutionClient.sendText({
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
        number: targetNumber,
        text: reply,
      });
    } catch (err) {
      this.logger.warn(`evolution send failed for conversation=${args.conversationId}: ${(err as Error).message}`);
    }
  }

  private async insertReply(
    ctx: AutoReplyContext,
    conversationId: string,
    content: string,
  ): Promise<string | null> {
    const [row] = await this.dataSource.query<
      { persona_auto_reply_insert_message: string }[]
    >(
      `SELECT public.persona_auto_reply_insert_message($1, $2, $3, $4, $5) AS persona_auto_reply_insert_message`,
      [ctx.account_id, conversationId, ctx.inbox_id, content, ctx.persona_id],
    );
    return row?.persona_auto_reply_insert_message ?? null;
  }
}
