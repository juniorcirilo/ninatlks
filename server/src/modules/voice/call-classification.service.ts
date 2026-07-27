import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { lovableChatCompletion } from './lovable-ai.util';

const DEFAULT_SDR_CATEGORIES = [
  'scheduled',
  'qualified',
  'not_interested',
  'callback',
  'no_answer',
  'voicemail',
  'wrong_number',
  'escalated',
  'other',
] as const;

const DEFAULT_SDR_SCORE: Record<string, { stageName: string; score: number }> =
  {
    scheduled: { stageName: 'Reunião agendada', score: 95 },
    qualified: { stageName: 'Qualificado', score: 70 },
    callback: { stageName: 'Contatado', score: 50 },
    escalated: { stageName: 'Qualificado', score: 60 },
    no_answer: { stageName: 'Contatado', score: 20 },
    voicemail: { stageName: 'Contatado', score: 15 },
    not_interested: { stageName: 'Perdeu', score: 5 },
    wrong_number: { stageName: 'Perdeu', score: 0 },
    other: { stageName: 'Contatado', score: 30 },
  };

const SDR_HEURISTICS: { category: string; patterns: RegExp[] }[] = [
  {
    category: 'wrong_number',
    patterns: [
      /n[uú]mero errado/,
      /n[aã]o conhe[çc]o/,
      /pessoa errada/,
      /n[aã]o [eé] essa pessoa/,
    ],
  },
  {
    category: 'voicemail',
    patterns: [/deixe (sua|uma) mensagem/, /caixa postal/, /ap[óo]s o sinal/],
  },
  {
    category: 'scheduled',
    patterns: [
      /agend(ado|amos|ar) (uma )?reuni[aã]o/,
      /marcamos para/,
      /confirmado para/,
      /reuni[aã]o (na|em|dia)/,
      /remarcad[ao] para/,
      /remarcamos/,
    ],
  },
  {
    category: 'callback',
    patterns: [
      /me lig[ua] (depois|mais tarde|amanh[aã])/,
      /retorn[ae] (depois|mais tarde)/,
      /agora n[aã]o posso/,
      /pode ligar (depois|amanh[aã])/,
    ],
  },
  {
    category: 'not_interested',
    patterns: [
      /n[aã]o tenho interesse/,
      /n[aã]o me interessa/,
      /n[aã]o quero/,
      /sem interesse/,
      /n[aã]o [eé] pra mim/,
    ],
  },
  {
    category: 'escalated',
    patterns: [
      /quero falar com (um humano|uma pessoa|atendente|gerente|recep[çc][aã]o)/,
      /me transfer/,
      /passa para algu[eé]m/,
    ],
  },
];

const NAME_STOPWORDS = new Set([
  'voce',
  'você',
  'gente',
  'tudo',
  'certo',
  'sim',
  'nao',
  'não',
  'oi',
  'ola',
  'olá',
  'alo',
  'alô',
  'agente',
  'nina',
  'doutor',
  'doutora',
  'senhor',
  'senhora',
  'pessoal',
  'amigo',
  'amiga',
  'moço',
  'moca',
  'moça',
  'querido',
  'querida',
  'obrigado',
  'obrigada',
]);

const NAME_LINE_PATTERNS: RegExp[] = [
  /meu nome (?:é|eh|e)\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/i,
  /(?:^|[\s,.])sou (?:o |a |um |uma )?([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/m,
  /aqui (?:é|eh|e)\s+(?:o |a )?([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/i,
  /(?:é|eh)\s+(?:o |a )([A-ZÀ-Ý][a-zà-ÿ]+)\s+falando/i,
  /quem fala (?:é|eh)\s+(?:o |a )?([A-ZÀ-Ý][a-zà-ÿ]+)/i,
  /pode me chamar de\s+([A-ZÀ-Ý][a-zà-ÿ]+)/i,
];

interface Briefing {
  dor: string | null;
  fit: string | null;
  objections: string[];
  next_action: string | null;
}

interface Classification {
  category: string;
  confidence: number;
  score: number;
  summary: string;
  briefing: Briefing;
  contact_name: string | null;
}

interface OutcomeDef {
  code: string;
  label: string;
  description: string | null;
  score: number;
}

interface CallRow {
  id: string;
  account_id: string;
  conversation_id: string | null;
  from_number: string | null;
  to_number: string | null;
  transcript: unknown;
  metadata: Record<string, unknown> | null;
  direction: string | null;
  classification: Record<string, unknown> | null;
  outcome_category: string | null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function emptyBriefing(): Briefing {
  return { dor: null, fit: null, objections: [], next_action: null };
}

/**
 * Ported from supabase/functions/lead-classify-from-call — post-call SDR
 * classification: heuristic regex pass, LLM fallback (Lovable AI Gateway),
 * contact resolution/creation, stage/score/briefing updates, and campaign
 * smart-retry. DataSource direct, same cross-context rationale as
 * CallSentimentService.
 */
@Injectable()
export class CallClassificationService {
  private readonly logger = new Logger(CallClassificationService.name);

  constructor(private readonly dataSource: DataSource) {}

  async classify(voiceCallId: string): Promise<
    | {
        ok: true;
        voice_call_id: string;
        contact_id: string;
        stage_id: string | null;
        classification: Classification;
        smart_retry: unknown;
        skipped?: boolean;
        reason?: string;
      }
    | { ok: false; error: string; status: number }
  > {
    const rows = await this.dataSource.query<CallRow[]>(
      `SELECT * FROM public.voice_call_get($1)`,
      [voiceCallId],
    );
    const call = rows[0];
    if (!call) return { ok: false, error: 'voice_call not found', status: 404 };

    const existing = call.classification;
    if (
      existing &&
      typeof existing === 'object' &&
      existing.source === 'agent_tool'
    ) {
      this.logger.log(`skip — call=${call.id} já classificada via agent_tool`);
      return {
        ok: true,
        voice_call_id: call.id,
        contact_id: '',
        stage_id: null,
        classification: existing as unknown as Classification,
        smart_retry: null,
        skipped: true,
        reason: 'already classified by agent_tool',
      };
    }

    const summary = (call.metadata?.summary as string | undefined) ?? null;
    const transcriptText = this.extractTranscriptText(call.transcript);
    if (!transcriptText && !summary) {
      return {
        ok: false,
        error: 'no transcript or summary to classify',
        status: 400,
      };
    }

    const campaignKind =
      (call.metadata?.campaign_kind as string | undefined) ?? 'sdr';
    const catalog = await this.loadOutcomesCatalog(
      call.account_id,
      campaignKind,
    );

    let classification: Classification;
    try {
      classification = await this.doClassify(
        transcriptText,
        summary,
        catalog,
        campaignKind,
      );
    } catch (err) {
      this.logger.error(`classify failed: ${(err as Error).message}`);
      return {
        ok: false,
        error: (err as Error).message ?? 'classification failed',
        status: 500,
      };
    }

    const contactId = await this.resolveContactId(call);
    if (!contactId) {
      return {
        ok: false,
        error: 'could not resolve or create contact',
        status: 500,
      };
    }

    const stageInfo =
      DEFAULT_SDR_SCORE[classification.category] ?? DEFAULT_SDR_SCORE.other;
    const stageId =
      campaignKind === 'sdr'
        ? await this.resolveStageId(call.account_id, stageInfo.stageName)
        : null;

    let nameToSet: string | null = null;
    if (classification.contact_name) {
      const existingRows = await this.dataSource.query<
        { name: string | null }[]
      >(`SELECT * FROM public.contact_get_by_id($1)`, [contactId]);
      const currentName = existingRows[0]?.name;
      if (!currentName || !currentName.trim())
        nameToSet = classification.contact_name;
    }

    await this.dataSource.query(
      `SELECT public.contact_update_classification($1, $2, $3::jsonb, $4, $5, $6)`,
      [
        contactId,
        classification.score,
        JSON.stringify(classification.briefing),
        call.direction === 'outbound' ? 'outbound' : 'inbound',
        stageId,
        nameToSet,
      ],
    );

    await this.dataSource.query(
      `SELECT public.voice_call_update_classification($1, $2, $3, $4, $5::jsonb)`,
      [
        call.id,
        classification.category,
        classification.confidence,
        classification.summary,
        JSON.stringify(classification),
      ],
    );

    if (call.conversation_id) {
      await this.dataSource.query(
        `SELECT public.conversation_outcome_insert($1, $2, $3, $4, $5, 'lead-classify-from-call', $6::jsonb)`,
        [
          call.account_id,
          call.conversation_id,
          contactId,
          classification.category,
          classification.confidence,
          JSON.stringify({
            score: classification.score,
            summary: classification.summary,
          }),
        ],
      );
    }

    const campaignContactId = call.metadata?.campaign_contact_id as
      string | number | undefined;
    const campaignId = call.metadata?.campaign_id as string | undefined;
    let smartRetry: unknown = null;
    if (campaignContactId && campaignId) {
      try {
        smartRetry = await this.applySmartRetry({
          campaignContactId,
          campaignId,
          accountId: call.account_id,
          outcomeCode: classification.category,
          kind: (call.metadata?.campaign_kind as string | undefined) ?? 'sdr',
        });
      } catch (err) {
        smartRetry = { error: (err as Error).message };
      }
    }

    this.logger.log(
      `call=${call.id} category=${classification.category} score=${classification.score} contact=${contactId} stage=${stageId ?? '—'}`,
    );

    return {
      ok: true,
      voice_call_id: call.id,
      contact_id: contactId,
      stage_id: stageId,
      classification,
      smart_retry: smartRetry,
    };
  }

  private async applySmartRetry(args: {
    campaignContactId: string | number;
    campaignId: string;
    accountId: string;
    outcomeCode: string;
    kind: string;
  }): Promise<unknown> {
    const RETRYABLE = new Set([
      'no_answer',
      'busy',
      'voicemail',
      'disconnected',
      'caixa_postal',
      'nao_atendeu',
    ]);

    const contactRows = await this.dataSource.query<
      { id: string; attempts: number }[]
    >(`SELECT * FROM public.voice_campaign_contact_get($1)`, [
      args.campaignContactId,
    ]);
    const contactRow = contactRows[0];
    if (!contactRow) return { action: 'skipped', reason: 'row not found' };

    const campaignRows = await this.dataSource.query<
      {
        retry_rules: Record<
          string,
          { max_attempts?: number; delay_minutes?: number }
        >;
        retry_attempts: number;
        retry_delay_minutes: number;
      }[]
    >(`SELECT * FROM public.voice_campaign_get_retry_config($1)`, [
      args.campaignId,
    ]);
    const campaign = campaignRows[0];
    const rules = campaign?.retry_rules ?? {};
    const ruleForOutcome = rules[args.outcomeCode] ?? null;

    const catalogRows = await this.dataSource.query<{ terminal: boolean }[]>(
      `SELECT * FROM public.call_outcomes_catalog_get_terminal($1, $2, $3)`,
      [args.kind, args.outcomeCode, args.accountId],
    );
    const terminal = catalogRows[0]?.terminal === true;

    const isRetryable =
      !terminal &&
      (RETRYABLE.has(args.outcomeCode) ||
        (ruleForOutcome?.max_attempts ?? 0) > 0);

    if (!isRetryable) {
      await this.dataSource.query(
        `SELECT public.voice_campaign_contact_complete($1)`,
        [args.campaignContactId],
      );
      return { action: 'completed', outcome: args.outcomeCode, terminal };
    }

    const maxAttempts =
      ruleForOutcome?.max_attempts ?? campaign?.retry_attempts ?? 2;
    const attempts = (contactRow.attempts ?? 0) + 1;
    if (attempts >= maxAttempts) {
      await this.dataSource.query(
        `SELECT public.voice_campaign_contact_fail($1, $2, $3)`,
        [
          args.campaignContactId,
          attempts,
          `max retries reached after ${args.outcomeCode}`,
        ],
      );
      return {
        action: 'exhausted',
        outcome: args.outcomeCode,
        attempts,
        maxAttempts,
      };
    }

    const delayMin =
      ruleForOutcome?.delay_minutes ?? campaign?.retry_delay_minutes ?? 60;
    const nextTry = new Date(Date.now() + delayMin * 60_000);
    await this.dataSource.query(
      `SELECT public.voice_campaign_contact_requeue($1, $2, $3)`,
      [args.campaignContactId, attempts, nextTry],
    );
    return {
      action: 'requeued',
      outcome: args.outcomeCode,
      attempts,
      nextTry,
      delayMin,
    };
  }

  private asString(v: unknown): string | null {
    return typeof v === 'string' ? v : null;
  }

  private extractTranscriptText(transcript: unknown): string {
    if (!transcript) return '';
    if (typeof transcript === 'string') return transcript;
    if (Array.isArray(transcript)) {
      return transcript
        .map((t: Record<string, unknown>) => {
          const role = this.asString(t.role) ?? this.asString(t.speaker) ?? '';
          const content =
            this.asString(t.content) ??
            this.asString(t.message) ??
            this.asString(t.text) ??
            '';
          return `${role}: ${content}`;
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  private async resolveContactId(call: CallRow): Promise<string | null> {
    const metaContactId = call.metadata?.contact_id;
    if (typeof metaContactId === 'string' && metaContactId)
      return metaContactId;

    if (call.conversation_id) {
      const rows = await this.dataSource.query<{ contact_id: string | null }[]>(
        `SELECT * FROM public.conversation_get_contact_id($1)`,
        [call.conversation_id],
      );
      if (rows[0]?.contact_id) return rows[0].contact_id;
    }

    const leadPhone =
      call.direction === 'outbound' ? call.to_number : call.from_number;
    if (!leadPhone) return null;

    const existingRows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.contact_get_by_phone($1, $2)`,
      [call.account_id, leadPhone],
    );
    if (existingRows[0]?.id) return existingRows[0].id;

    const md = call.metadata ?? {};
    const dynamicVariables = md.dynamic_variables as
      Record<string, unknown> | undefined;
    const seedRaw =
      (md.lead_name as string | undefined) ??
      (md.contact_name as string | undefined) ??
      (md.invitee_name as string | undefined) ??
      (dynamicVariables?.lead_name as string | undefined);
    const seedName =
      typeof seedRaw === 'string' &&
      seedRaw.trim().length >= 2 &&
      seedRaw.trim().length <= 80
        ? seedRaw.trim()
        : null;

    const createdRows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.contact_get_or_create($1, $2, $3, $4, $5)`,
      [
        call.account_id,
        leadPhone,
        `sms:${leadPhone}`,
        call.direction === 'outbound' ? 'outbound' : 'inbound',
        seedName ?? leadPhone,
      ],
    );
    return createdRows[0]?.id ?? null;
  }

  private async resolveStageId(
    accountId: string,
    stageName: string,
  ): Promise<string | null> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT * FROM public.lead_stage_resolve_default($1, $2)`,
      [accountId, stageName],
    );
    return rows[0]?.id ?? null;
  }

  private async loadOutcomesCatalog(
    accountId: string,
    kind: string,
  ): Promise<OutcomeDef[]> {
    const rows = await this.dataSource.query<
      {
        code: string;
        label: string;
        description: string | null;
        score: number;
      }[]
    >(`SELECT * FROM public.call_outcomes_catalog_list($1, $2)`, [
      kind,
      accountId,
    ]);
    const seen = new Set<string>();
    const out: OutcomeDef[] = [];
    for (const r of rows) {
      if (seen.has(r.code)) continue;
      seen.add(r.code);
      out.push({
        code: r.code,
        label: r.label,
        description: r.description ?? null,
        score: r.score ?? 0,
      });
    }
    return out;
  }

  private async doClassify(
    transcriptText: string,
    summary: string | null,
    catalog: OutcomeDef[],
    kind: string,
  ): Promise<Classification> {
    const text = (transcriptText + '\n' + (summary ?? '')).toLowerCase();
    const heuristicName = this.extractNameHeuristic(transcriptText);
    const allowedCodes =
      catalog.length > 0
        ? catalog.map((c) => c.code)
        : [...DEFAULT_SDR_CATEGORIES];

    if (kind === 'sdr') {
      for (const h of SDR_HEURISTICS) {
        for (const p of h.patterns) {
          if (p.test(text)) {
            const base = DEFAULT_SDR_SCORE[h.category] ?? { score: 30 };
            return {
              category: h.category,
              confidence: 0.92,
              score: base.score,
              summary: this.extractSummaryFromText(text, 200),
              briefing: emptyBriefing(),
              contact_name: heuristicName,
            };
          }
        }
      }
    }

    if (!process.env.LOVABLE_API_KEY) {
      return {
        category: 'other',
        confidence: 0.3,
        score: 30,
        summary: summary ?? '',
        briefing: emptyBriefing(),
        contact_name: heuristicName,
      };
    }

    const sample = (transcriptText || summary || '').slice(0, 4000);
    const catalogList = (
      catalog.length > 0
        ? catalog
        : DEFAULT_SDR_CATEGORIES.map((c) => ({
            code: c,
            label: c,
            description: null as string | null,
            score: DEFAULT_SDR_SCORE[c]?.score ?? 30,
          }))
    )
      .map(
        (c) =>
          `- ${c.code}${c.label && c.label !== c.code ? ` (${c.label})` : ''}${c.description ? `: ${c.description}` : ''}`,
      )
      .join('\n');

    const prompt = `Você é um analista de operações de IA (tipo: ${kind}). Analise a transcrição abaixo e devolva APENAS JSON válido (sem markdown).

Categorias possíveis (use EXATAMENTE um destes códigos no campo "category"):
${catalogList}

Transcrição:
${sample}

Responda EXATAMENTE neste formato:
{
  "category": "<um código da lista acima>",
  "confidence": <0..1>,
  "score": <0..100, prioridade/qualidade do contato>,
  "summary": "<1 frase em PT-BR resumindo o resultado>",
  "contact_name": "<nome próprio do contato se identificado, senão null. Sem títulos>",
  "briefing": {
    "dor": "<dor/motivo, ou null>",
    "fit": "<por que dá ou não dá fit, ou null>",
    "objections": ["<objeção 1>"],
    "next_action": "<recomendação, ou null>"
  }
}`;

    const content = await lovableChatCompletion({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      jsonMode: true,
    });
    if (!content) {
      return {
        category: 'other',
        confidence: 0.3,
        score: 30,
        summary: summary ?? '',
        briefing: emptyBriefing(),
        contact_name: heuristicName,
      };
    }

    try {
      const parsed = JSON.parse(content) as {
        category?: string;
        confidence?: number;
        score?: number;
        summary?: string;
        contact_name?: string;
        briefing?: unknown;
      };
      const category = allowedCodes.includes(parsed.category ?? '')
        ? (parsed.category as string)
        : (allowedCodes[0] ?? 'other');
      const confidence =
        typeof parsed.confidence === 'number'
          ? clamp(parsed.confidence, 0, 1)
          : 0.5;
      const fallbackScore =
        catalog.find((c) => c.code === category)?.score ??
        DEFAULT_SDR_SCORE[category]?.score ??
        30;
      const score =
        typeof parsed.score === 'number'
          ? clamp(parsed.score, 0, 100)
          : fallbackScore;
      const llmName =
        typeof parsed.contact_name === 'string'
          ? this.sanitizeName(parsed.contact_name)
          : null;

      return {
        category,
        confidence,
        score,
        summary:
          typeof parsed.summary === 'string'
            ? parsed.summary.slice(0, 280)
            : (summary ?? ''),
        briefing: this.normalizeBriefing(parsed.briefing),
        contact_name: llmName ?? heuristicName,
      };
    } catch {
      return {
        category: 'other',
        confidence: 0.3,
        score: 30,
        summary: summary ?? '',
        briefing: emptyBriefing(),
        contact_name: heuristicName,
      };
    }
  }

  private extractNameHeuristic(transcriptText: string): string | null {
    if (!transcriptText) return null;
    const tryName = (raw: string | undefined): string | null => {
      if (!raw) return null;
      const name = this.sanitizeName(raw);
      if (!name) return null;
      const first = name.split(/\s+/)[0]?.toLowerCase() ?? '';
      if (NAME_STOPWORDS.has(first)) return null;
      return name;
    };

    for (const re of NAME_LINE_PATTERNS) {
      const m = transcriptText.match(re);
      const cand = tryName(m?.[1]);
      if (cand) return cand;
    }

    const lines = transcriptText.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^agent:/i.test(line)) continue;
      const m = line.match(
        /(?:oi|olá|ola|alô|alo|bom dia|boa tarde|boa noite),?\s+([A-ZÀ-Ý][a-zà-ÿ]+)\b/i,
      );
      const cand = tryName(m?.[1]);
      if (!cand) continue;
      let corrected = false;
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const lj = lines[j].toLowerCase();
        if (/^user:/i.test(lines[j]) && /n[aã]o sou (?:o |a )?/i.test(lj)) {
          corrected = true;
          break;
        }
      }
      if (!corrected) return cand;
    }

    return null;
  }

  private sanitizeName(raw: string): string | null {
    const cleaned = raw
      .trim()
      .replace(/[^\p{L}\s'-]/gu, '')
      .trim();
    if (!cleaned) return null;
    if (cleaned.length < 2 || cleaned.length > 80) return null;
    return cleaned
      .split(/\s+/)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }

  private normalizeBriefing(b: unknown): Briefing {
    if (!b || typeof b !== 'object') return emptyBriefing();
    const obj = b as Record<string, unknown>;
    const objections = Array.isArray(obj.objections)
      ? obj.objections
          .filter((x): x is string => typeof x === 'string')
          .slice(0, 8)
      : [];
    return {
      dor: typeof obj.dor === 'string' ? obj.dor.slice(0, 400) : null,
      fit: typeof obj.fit === 'string' ? obj.fit.slice(0, 400) : null,
      objections,
      next_action:
        typeof obj.next_action === 'string'
          ? obj.next_action.slice(0, 400)
          : null,
    };
  }

  private extractSummaryFromText(text: string, max: number): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
  }
}
