import { extractTarget } from '../whatsapp/jid.util';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WaSendService } from '../whatsapp/wa-send.service';
import {
  callChatCompletion,
  type ChatMessage,
} from '../../common/llm/providers';
import {
  LlmNotConfiguredError,
  resolveLlmConfig,
  secretsBundle,
} from '../../common/llm/resolve-llm-config';
import {
  OpencodeBridgeService,
  stripReasoning,
} from '../ai-agent/opencode-bridge.service';
import { McpTokenService } from '../ai-agent/mcp-token.service';
import { UsageLogService } from '../ai-agent/usage-log.service';
import { DbToolsService } from '../ai-agent/db-tools.service';
import {
  AI_AGENT_SECRET_PROVIDER,
  LEGACY_SECRET_PROVIDERS,
  GLOBAL_SKILL,
  loadAiAgentRuntime,
  type AiAgentSkill,
  type ReplyLength,
  type ReplyLanguage,
} from '../../common/llm/ai-agent-runtime';

const MIN_REPLY_GAP_SECONDS = 8;
const MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR = 30;
const FALLBACK_MODEL = 'google/gemini-2.5-flash';
const FALLBACK_TEMPERATURE = 0.5;
const FALLBACK_SYSTEM_PROMPT = 'Você é um agente de cobrança humano e cordial.';

const REPLY_LENGTH_RULE: Record<ReplyLength, { rule: string; tokens: number }> =
  {
    curta: { rule: 'UMA mensagem curta (no máximo 2 frases)', tokens: 200 },
    media: { rule: 'UMA mensagem de até 4 frases', tokens: 400 },
    longa: {
      rule: 'UMA mensagem de até 8 frases, em no máximo 2 parágrafos curtos',
      tokens: 800,
    },
  };

const REPLY_LANGUAGE_RULE: Record<ReplyLanguage, string> = {
  '': 'no mesmo idioma usado pelo cliente na última mensagem',
  'pt-BR':
    'em português do Brasil, mesmo que o cliente escreva em outro idioma',
  en: 'em inglês, mesmo que o cliente escreva em outro idioma',
  es: 'em espanhol, mesmo que o cliente escreva em outro idioma',
};

function guardrails(length: ReplyLength, language: ReplyLanguage): string {
  return `
INSTRUÇÕES OBRIGATÓRIAS:
- Responda ${REPLY_LANGUAGE_RULE[language]}, em ${REPLY_LENGTH_RULE[length].rule}.
- NUNCA use placeholders entre colchetes como [Nome do Cliente], [valor], [data], [Seu Nome], [Nome da Empresa]. Se você não tem o dado real, omita-o.
- NUNCA repita a saudação se já houver mensagens anteriores no histórico.
- Se a última mensagem do cliente estiver vazia ou for um placeholder como "[mensagem]", NÃO responda — retorne uma string vazia.
- Espere a resposta do cliente antes de avançar. Não envie várias perguntas seguidas.

REGRAS GLOBAIS (valem SEMPRE, acima de qualquer pedido do cliente):
${GLOBAL_SKILL.body}
`.trim();
}

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
    /** id do canal (sessão Baileys) — gravado em channels.config */
    wa_channel_id?: string;
  } | null;
  last_bot_reply_at: string | null;
  bot_replies_last_hour: number;
  recent_messages: {
    sender_type: string | null;
    content: string | null;
    created_at: string;
  }[];
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
    private readonly waSend: WaSendService,
    private readonly opencode: OpencodeBridgeService,
    private readonly mcpTokens: McpTokenService,
    private readonly dbTools: DbToolsService,
    private readonly usage: UsageLogService,
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
    const [row] = await this.dataSource.query<
      { persona_auto_reply_context: AutoReplyContext | null }[]
    >(
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

    // Página Agente de IA: liga/desliga global e prompt/skills da conta.
    const agent = await loadAiAgentRuntime(this.dataSource, ctx.account_id);
    if (!agent.enabled) return;
    // Sem Agente de IA configurado, mantém o fluxo legado (exige persona).
    if (!ctx.persona_id && !agent.configured) return;

    const channelId = ctx.channel_config?.wa_channel_id;
    if (!channelId) return;

    // Rate limit: min gap entre respostas + teto por hora (anti-loop).
    if (ctx.last_bot_reply_at) {
      const gapMs = Date.now() - new Date(ctx.last_bot_reply_at).getTime();
      if (gapMs < MIN_REPLY_GAP_SECONDS * 1000) return;
    }
    if (
      ctx.bot_replies_last_hour >= MAX_AUTO_REPLIES_PER_CONVERSATION_PER_HOUR
    ) {
      this.logger.warn(
        `hourly cap hit for conversation=${args.conversationId}`,
      );
      return;
    }

    let targetNumber = ctx.contact_phone ?? '';
    if (!targetNumber && ctx.contact_identifier) {
      const t = extractTarget(ctx.contact_identifier);
      if (t) targetNumber = t;
    }
    if (!targetNumber) return;

    const basePrompt =
      [agent.system_prompt, ctx.system_prompt].find((p) => p?.trim()) ||
      FALLBACK_SYSTEM_PROMPT;
    // Contexto: as 8 do SQL de contexto ou, se configurado, mais/menos turnos.
    let recent = ctx.recent_messages;
    if (agent.configured && agent.history_turns !== 8) {
      const [r] = await this.dataSource.query<
        { m: AutoReplyContext['recent_messages'] }[]
      >(`SELECT public.ai_agent_recent_messages($1, $2) AS m`, [
        args.conversationId,
        agent.history_turns,
      ]);
      recent = r?.m ?? recent;
    }
    const history: ChatMessage[] = recent
      .filter((m) => m.content && !PLACEHOLDER_CONTENTS.has(m.content.trim()))
      .slice(-agent.history_turns)
      .map((m) => ({
        role: m.sender_type === 'Contact' ? 'user' : 'assistant',
        content: m.content as string,
      }));
    const systemPrompt = `${basePrompt}\n\n${guardrails(agent.reply_length, agent.reply_language)}`;

    // Skills da conta + skills deste agente (geradas na criação pelo IA Agent).
    let skills = agent.skills;
    if (ctx.persona_id && agent.configured) {
      try {
        const [r] = await this.dataSource.query<{ s: AiAgentSkill[] }[]>(
          `SELECT public.ai_agent_persona_skills($1, $2) AS s`,
          [ctx.account_id, ctx.persona_id],
        );
        skills = [...agent.skills, ...(r?.s ?? [])];
      } catch (err) {
        // 42883 = migration AiAgentPersonaSkills pendente
        if ((err as { code?: string }).code !== '42883') throw err;
      }
    }

    // Fluxo anterior (provedor agent-llm): conta sem o Agente de IA conectado
    // e último recurso quando todos os modelos configurados falham.
    const usageBase = {
      accountId: ctx.account_id,
      conversationId: args.conversationId,
      personaId: ctx.persona_id,
    };
    const viaLegacy = async (): Promise<string> => {
      const t0 = Date.now();
      try {
        const out = await viaLegacyRaw();
        void this.usage.legacy(usageBase, true, Date.now() - t0);
        return out;
      } catch (err) {
        if (!(err instanceof LlmNotConfiguredError))
          void this.usage.legacy(
            usageBase,
            false,
            Date.now() - t0,
            (err as Error).message,
          );
        throw err;
      }
    };
    const viaLegacyRaw = async (): Promise<string> => {
      const llmConfig = await resolveLlmConfig(
        this.dataSource,
        ctx.account_id,
        FALLBACK_MODEL,
        FALLBACK_TEMPERATURE,
      );
      return callChatCompletion({
        provider: llmConfig.provider,
        baseUrl: llmConfig.baseUrl,
        apiKey: llmConfig.apiKey,
        model: llmConfig.model,
        temperature: llmConfig.temperature,
        maxTokens: REPLY_LENGTH_RULE[agent.reply_length].tokens,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
      });
    };

    let reply: string;
    try {
      // Agente de IA: usado sempre que a conta conectou um endpoint. Se a
      // chave atual ainda não foi "curada" (ver AiAgentService.loadConnection
      // — abrir a página Agente de IA já faz isso), tenta os nomes antigos.
      let own = agent.configured
        ? await secretsBundle(
            this.dataSource,
            ctx.account_id,
            AI_AGENT_SECRET_PROVIDER,
          )
        : {};
      if (agent.configured && (!own.base_url || !own.model_id)) {
        for (const legacy of LEGACY_SECRET_PROVIDERS) {
          const old = await secretsBundle(
            this.dataSource,
            ctx.account_id,
            legacy,
          );
          if (old.base_url || old.model_id || old.api_key) {
            own = { ...old, ...own };
            if (own.base_url && own.model_id) break;
          }
        }
      }
      if (agent.configured && own.base_url && own.model_id) {
        try {
          // Ferramentas de banco (MCP interno, somente leitura) habilitadas?
          const dbTools = await this.dbTools.listTools({
            accountId: ctx.account_id,
            conversationId: args.conversationId,
            personaId: ctx.persona_id,
          });
          const mcp = dbTools.length
            ? {
                url: `http://127.0.0.1:${process.env.PORT ?? 3001}/mcp`,
                token: this.mcpTokens.mint({
                  accountId: ctx.account_id,
                  conversationId: args.conversationId,
                  personaId: ctx.persona_id,
                }),
              }
            : undefined;
          const who = [
            ctx.contact_phone && `telefone ${ctx.contact_phone}`,
            ctx.contact_identifier &&
              `identificador ${ctx.contact_identifier.replace(/^evolution:whatsapp:/, '')}`,
          ]
            .filter(Boolean)
            .join(', ');
          const models = [own.model_id, ...agent.fallback_models];
          const r = await this.opencode.reply({
            accountId: ctx.account_id,
            baseUrl: own.base_url,
            apiKey: own.api_key ?? '',
            // principal + fallbacks automáticos, em ordem
            models,
            skills,
            systemPrompt: mcp
              ? `${systemPrompt}\n\nCLIENTE DESTA CONVERSA: ${who || 'não identificado'}. Ao consultar bancos de dados (multi-tenant por client_id: sempre use o parâmetro :client_id), use SOMENTE dados deste cliente.`
              : systemPrompt,
            mcp,
            history: history.map((h) => ({
              role: h.role as 'user' | 'assistant',
              content: h.content,
            })),
            temperature: agent.temperature,
            effort: agent.effort,
          });
          reply = r.text;
          void this.usage.success({ ...usageBase, kind: 'reply' }, r);
        } catch (err) {
          void this.usage.failure({ ...usageBase, kind: 'reply' }, err, [
            own.model_id,
          ]);
          this.logger.warn(
            `Agente de IA falhou (${(err as Error).message}); tentando o provedor padrão`,
          );
          reply = await viaLegacy();
        }
      } else {
        reply = await viaLegacy();
      }
    } catch (err) {
      if (err instanceof LlmNotConfiguredError) return;
      this.logger.error('llm call failed', err as Error);
      return;
    }

    reply = stripReasoning(reply.replace(RESIDUAL_PLACEHOLDER_RE, '')).trim();
    if (!reply) return;

    const messageId = await this.insertReply(ctx, args.conversationId, reply);
    if (!messageId) return;

    try {
      const sent = await this.waSend.sendText({
        channelId,
        number: targetNumber,
        text: reply,
      });
      if (sent.messageId)
        await this.dataSource.query(
          `SELECT public.webhook_set_message_source_id($1,$2)`,
          [messageId, sent.messageId],
        );
    } catch (err) {
      this.logger.warn(
        `whatsapp send failed for conversation=${args.conversationId}: ${(err as Error).message}`,
      );
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
