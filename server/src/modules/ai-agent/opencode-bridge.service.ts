import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  GLOBAL_SKILL,
  type AiAgentSkill,
} from '../../common/llm/ai-agent-runtime';

const MAX_OUTPUT_BYTES = 256 * 1024;
const AGENT_NAME = 'atendimento';
/** Nome do provider customizado dentro do opencode.json (não é o "opencode" da Zen). */
const PROVIDER_NAME = 'custom';
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'max']);

export class OpencodeUnavailableError extends Error {}

export interface BridgeTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface BridgeUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** a maioria dos provedores openai-compatible não informa custo. */
  cost: number;
}

/** Evento bruto de uma linha do `--format json` (repassado em tempo real). */
export type BridgeEvent = Record<string, unknown>;
export type BridgeEventSink = (ev: BridgeEvent) => void;

export interface BridgeResult {
  text: string;
  /** modelo que de fato respondeu (pode ser um fallback) */
  model: string;
  /** falhas dos modelos tentados antes dele */
  failures: { model: string; error: string }[];
  /** consumo da resposta (do modelo que respondeu) */
  usage: BridgeUsage;
  /** tempo total, somando as tentativas */
  durationMs: number;
}

/** Falha de todos os modelos: carrega as tentativas e o tempo gasto. */
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly failures: { model: string; error: string }[],
    readonly durationMs: number,
  ) {
    super(message);
  }
}

/** SKILL.md no formato do OpenCode (frontmatter name + description). */
export function renderSkillMd(s: AiAgentSkill): string {
  const q = (v: string) => JSON.stringify(v.replace(/\s+/g, ' ').trim());
  return `---\nname: ${s.slug}\ndescription: ${q(s.description)}\n---\n\n# ${s.name}\n\n${s.body.trim()}\n`;
}

/**
 * Ponte para o OpenCode CLI (`opencode run`): cada conta tem um workspace
 * isolado com as skills de atendimento em `.opencode/skills/<slug>/SKILL.md`
 * e um agente "atendimento" (temperatura configurável).
 *
 * O MODELO fala com um provedor compatível com a API da OpenAI que A CONTA
 * configurou (Base URL + API Key + modelo) — nunca os modelos gratuitos da
 * Zen do próprio OpenCode. O provider é declarado como "custom" no
 * `opencode.json`, via `@ai-sdk/openai-compatible`.
 *
 * O agente é de atendimento (só responde texto), então TODAS as ferramentas
 * embutidas ficam listadas mas sem poder agir (ver `syncWorkspace`), e o
 * processo roda com ambiente limpo, HOME dentro do workspace e, quando o
 * servidor é root, com uid/gid sem privilégio.
 *
 * Fallback automático: `reply` tenta os modelos em ordem (principal, depois
 * os de fallback, todos do MESMO provider) e devolve o primeiro que responder.
 */
@Injectable()
export class OpencodeBridgeService {
  private readonly logger = new Logger(OpencodeBridgeService.name);

  constructor(private readonly config: ConfigService) {}

  private get root(): string {
    return (
      this.config.get<string>('OPENCODE_WORKSPACE_DIR') ?? '/data/opencode'
    );
  }
  private get bin(): string {
    return this.config.get<string>('OPENCODE_BIN') ?? 'opencode';
  }
  private get timeoutMs(): number {
    return Number(this.config.get('OPENCODE_TIMEOUT_MS') ?? 90_000);
  }
  private get dropTo(): { uid: number; gid: number } | null {
    if (typeof process.getuid !== 'function' || process.getuid() !== 0)
      return null;
    const uid = Number(this.config.get('OPENCODE_RUN_UID') ?? 1000);
    const gid = Number(this.config.get('OPENCODE_RUN_GID') ?? uid);
    return { uid, gid };
  }

  private workspace(accountId: string): string {
    // accountId vem do banco (uuid); validar mesmo assim contra path traversal.
    if (!/^[0-9a-f-]{36}$/i.test(accountId))
      throw new Error('invalid account id');
    return path.join(this.root, accountId);
  }

  private async write(file: string, data: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, { mode: 0o640 });
  }

  private async chownTree(dir: string): Promise<void> {
    const to = this.dropTo;
    if (!to) return;
    await fs.chown(dir, to.uid, to.gid).catch(() => undefined);
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await this.chownTree(p);
      else await fs.chown(p, to.uid, to.gid).catch(() => undefined);
    }
  }

  /**
   * Materializa opencode.json (provider customizado + agente + skills) e os
   * SKILL.md (a global sempre entra); remove skills que deixaram de existir.
   */
  async syncWorkspace(
    accountId: string,
    skills: AiAgentSkill[],
    baseUrl: string,
    apiKey: string,
    models: string[],
    temperature?: number | null,
  ): Promise<string> {
    const dir = this.workspace(accountId);
    const skillsDir = path.join(dir, '.opencode', 'skills');
    await fs.mkdir(path.join(dir, '.home'), { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });

    const cfg = {
      $schema: 'https://opencode.ai/config.json',
      autoupdate: false,
      share: 'disabled',
      snapshot: false,
      // Provedor compatível com a API da OpenAI configurado pela conta —
      // NUNCA os modelos gratuitos da Zen do próprio OpenCode.
      provider: {
        [PROVIDER_NAME]: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Provedor da conta',
          options: {
            baseURL: baseUrl,
            ...(apiKey ? { apiKey: '{env:OPENCODE_API_KEY}' } : {}),
          },
          models: Object.fromEntries(models.map((m) => [m, { name: m }])),
        },
      },
      agent: {
        [AGENT_NAME]: {
          description: 'Agente de atendimento ao cliente (somente texto).',
          mode: 'primary',
          ...(temperature != null ? { temperature } : {}),
        },
      },
      // Ferramentas embutidas ficam LISTADAS mas sem poder agir: em modo não
      // interativo "ask" é recusado automaticamente ("auto-rejecting"). As
      // ferramentas MCP do utalks (banco) e a skill ficam liberadas.
      permission: {
        bash: 'ask',
        edit: 'ask',
        read: 'ask',
        glob: 'ask',
        grep: 'ask',
        list: 'ask',
        task: 'ask',
        todowrite: 'ask',
        todoread: 'ask',
        webfetch: 'ask',
        websearch: 'ask',
        codesearch: 'ask',
        lsp: 'ask',
        external_directory: 'deny',
        doom_loop: 'deny',
        skill: 'allow',
        'utalks_*': 'allow',
      },
    };
    await this.write(
      path.join(dir, 'opencode.json'),
      JSON.stringify(cfg, null, 2),
    );

    const all = [
      GLOBAL_SKILL,
      ...skills.filter((s) => s.slug !== GLOBAL_SKILL.slug),
    ];
    const wanted = new Set(all.map((s) => s.slug));
    for (const existing of await fs
      .readdir(skillsDir)
      .catch(() => [] as string[])) {
      if (!wanted.has(existing))
        await fs.rm(path.join(skillsDir, existing), {
          recursive: true,
          force: true,
        });
    }
    for (const s of all) {
      const file = path.join(skillsDir, s.slug, 'SKILL.md');
      const md = renderSkillMd(s);
      const cur = await fs.readFile(file, 'utf8').catch(() => null);
      if (cur !== md) await this.write(file, md);
    }
    await this.chownTree(dir);
    return dir;
  }

  /** Responde tentando `models` em ordem (principal primeiro, depois fallbacks). */
  async reply(args: {
    accountId: string;
    baseUrl: string;
    apiKey: string;
    /** principal + fallbacks, em ordem de tentativa (modelos do provider customizado) */
    models: string[];
    skills: AiAgentSkill[];
    systemPrompt: string;
    history: BridgeTurn[];
    temperature?: number | null;
    effort?: string;
    /** Prompt completo e literal (ex.: geração de skill); ignora o formato de conversa. */
    rawPrompt?: string;
    /** Servidor MCP (ferramentas do agente) deste turno. */
    mcp?: { url: string; token: string };
    /** Recebe cada evento do CLI assim que acontece (raciocínio, ferramentas, texto). */
    onEvent?: BridgeEventSink;
    /** Cancela a tentativa em andamento (cliente desconectou, operação cancelada). */
    signal?: AbortSignal;
    /** Teto para a soma de todas as tentativas (padrão: timeoutMs × nº de modelos). */
    overallTimeoutMs?: number;
  }): Promise<BridgeResult> {
    if (!args.baseUrl.trim()) throw new Error('Base URL não configurada.');
    const models = [
      ...new Set(args.models.map((m) => m.trim()).filter(Boolean)),
    ];
    if (!models.length) throw new Error('nenhum modelo configurado');
    if (args.signal?.aborted) throw new Error('cancelado');

    const dir = await this.syncWorkspace(
      args.accountId,
      args.skills,
      args.baseUrl,
      args.apiKey,
      models,
      args.temperature,
    );
    const transcript = args.history
      .map(
        (t) => `${t.role === 'user' ? 'Cliente' : 'Atendente'}: ${t.content}`,
      )
      .join('\n');
    const prompt =
      args.rawPrompt ??
      [
        args.systemPrompt.trim(),
        `Skills disponíveis: a skill "${GLOBAL_SKILL.slug}" vale SEMPRE.${
          args.skills.length
            ? ' Use as demais skills quando forem relevantes para a pergunta do cliente.'
            : ''
        }`,
        '## Conversa até agora',
        transcript,
        'Escreva APENAS a próxima mensagem do Atendente, sem explicações, sem prefixos e sem usar ferramentas.',
      ].join('\n\n');

    const failures: BridgeResult['failures'] = [];
    const started = Date.now();
    const overall = args.overallTimeoutMs ?? this.timeoutMs * models.length;
    for (const model of models) {
      if (args.signal?.aborted) throw new Error('cancelado');
      if (Date.now() - started > overall) {
        throw new BridgeError(
          `tempo total esgotado (${Math.round(overall / 1000)}s) antes de tentar "${model}"`,
          failures,
          Date.now() - started,
        );
      }
      args.onEvent?.({ type: 'model_start', model });
      try {
        const { text, usage } = await this.run(
          dir,
          args.apiKey,
          model,
          prompt,
          args.effort,
          args.mcp,
          args.onEvent,
          args.signal,
        );
        if (failures.length)
          this.logger.warn(
            `fallback: respondeu com ${model} após falha(s): ${failures
              .map((f) => `${f.model} (${f.error})`)
              .join('; ')}`,
          );
        return {
          text,
          model,
          failures,
          usage,
          durationMs: Date.now() - started,
        };
      } catch (err) {
        // CLI ausente não melhora trocando de modelo.
        if (err instanceof OpencodeUnavailableError) throw err;
        const error = (err as Error).message.slice(0, 160);
        failures.push({ model, error });
        args.onEvent?.({ type: 'model_failed', model, error });
      }
    }
    throw new BridgeError(
      `todos os modelos falharam: ${failures.map((f) => `${f.model}: ${f.error}`).join(' | ')}`,
      failures,
      Date.now() - started,
    );
  }

  private run(
    dir: string,
    apiKey: string,
    model: string,
    prompt: string,
    effort?: string,
    mcp?: { url: string; token: string },
    onEvent?: BridgeEventSink,
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: BridgeUsage }> {
    // Sempre o provider customizado da conta — nunca "opencode/<modelo-free>".
    const full = `${PROVIDER_NAME}/${model}`;
    const drop = this.dropTo;
    const cliArgs = [
      'run',
      '--format',
      'json',
      '--dir',
      dir,
      '--agent',
      AGENT_NAME,
      '-m',
      full,
      ...(effort && EFFORTS.has(effort) ? ['--variant', effort] : []),
      prompt,
    ];
    return new Promise<{ text: string; usage: BridgeUsage }>(
      (resolve, reject) => {
        const child = spawn(this.bin, cliArgs, {
          cwd: dir,
          env: {
            PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
            HOME: path.join(dir, '.home'),
            ...(apiKey ? { OPENCODE_API_KEY: apiKey } : {}),
            OPENCODE_DISABLE_AUTOUPDATE: '1',
            // Config inline (o token efêmero não vai para o disco).
            ...(mcp
              ? {
                  OPENCODE_CONFIG_CONTENT: JSON.stringify({
                    mcp: {
                      utalks: {
                        type: 'remote',
                        url: mcp.url,
                        enabled: true,
                        headers: { Authorization: `Bearer ${mcp.token}` },
                      },
                    },
                  }),
                }
              : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(drop ? { uid: drop.uid, gid: drop.gid } : {}),
        });
        let stdout = '';
        let stderr = '';
        let size = 0;
        let settled = false;
        // Repassa cada linha completa assim que chega (o CLI escreve um JSON
        // por linha); a última linha pode ficar incompleta até o próximo chunk.
        let lineBuf = '';
        const feedLines = (chunk: string) => {
          if (!onEvent) return;
          lineBuf += chunk;
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';
          for (const l of lines) {
            const line = l.trim();
            if (!line.startsWith('{')) continue;
            try {
              onEvent(JSON.parse(line) as BridgeEvent);
            } catch {
              /* linha de log, não é evento */
            }
          }
        };
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        const kill = (why: string) => {
          child.kill('SIGKILL');
          done(() => reject(new Error(why)));
        };
        const timer = setTimeout(() => kill('timeout'), this.timeoutMs);
        const onAbort = () => kill('cancelado');
        signal?.addEventListener('abort', onAbort);
        child.on('close', () => signal?.removeEventListener('abort', onAbort));
        child.stdout.on('data', (b: Buffer) => {
          size += b.length;
          if (size > MAX_OUTPUT_BYTES) return kill('saída grande demais');
          const chunk = b.toString('utf8');
          stdout += chunk;
          feedLines(chunk);
        });
        child.stderr.on('data', (b: Buffer) => {
          if (stderr.length < 4000) stderr += b.toString('utf8');
        });
        child.on('error', (err: NodeJS.ErrnoException) =>
          done(() =>
            reject(
              err.code === 'ENOENT'
                ? new OpencodeUnavailableError(
                    'IA Agent indisponível: motor não instalado no servidor',
                  )
                : err,
            ),
          ),
        );
        child.on('close', (code) =>
          done(() => {
            // O OpenCode sai com 0 mesmo quando o provedor devolve erro: o erro
            // vem como evento {"type":"error"} no stream.
            const text = parseOpencodeJson(stdout);
            if (text)
              return resolve({ text, usage: parseOpencodeUsage(stdout) });
            const apiError = parseOpencodeError(stdout);
            if (apiError) return reject(new Error(apiError));
            if (code !== 0)
              return reject(new Error(`exit ${code}: ${stderr.slice(0, 200)}`));
            reject(new Error('sem texto na resposta'));
          }),
        );
      },
    );
  }
}

/**
 * Alguns modelos (ex.: DeepSeek R1) escrevem o raciocínio dentro do próprio
 * texto, em tags como `<think>`/`<thinking>`/`<reasoning>`, em vez de um
 * evento separado — o cliente nunca deve ver esse raciocínio.
 */
const THINK_TAG_RE = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;

export function stripReasoning(text: string): string {
  return text.replace(THINK_TAG_RE, '').trim();
}

/** Junta os eventos de texto do `--format json` (um objeto JSON por linha). */
export function parseOpencodeJson(stdout: string): string {
  const parts: string[] = [];
  for (const line of stdout.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('{')) continue;
    try {
      const ev = JSON.parse(l) as {
        type?: string;
        part?: { type?: string; text?: string };
        text?: string;
      };
      if (ev.type === 'text') {
        const t = ev.part?.text ?? ev.text;
        if (typeof t === 'string' && t.trim()) parts.push(t.trim());
      }
    } catch {
      /* linha de log, não é evento */
    }
  }
  return stripReasoning(parts.join('\n').trim());
}

/** Soma tokens e custo dos eventos step_finish do `--format json`. */
export function parseOpencodeUsage(stdout: string): BridgeUsage {
  const u: BridgeUsage = {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
  for (const line of stdout.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('{')) continue;
    try {
      const ev = JSON.parse(l) as {
        type?: string;
        part?: {
          cost?: number;
          tokens?: {
            input?: number;
            output?: number;
            reasoning?: number;
            cache?: { read?: number; write?: number };
          };
        };
      };
      if (ev.type !== 'step_finish') continue;
      const t = ev.part?.tokens;
      u.input += t?.input ?? 0;
      u.output += t?.output ?? 0;
      u.reasoning += t?.reasoning ?? 0;
      u.cacheRead += t?.cache?.read ?? 0;
      u.cacheWrite += t?.cache?.write ?? 0;
      u.cost += ev.part?.cost ?? 0;
    } catch {
      /* linha de log */
    }
  }
  return u;
}

/** Mensagem do primeiro evento {"type":"error"} do `--format json`, se houver. */
export function parseOpencodeError(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('{')) continue;
    try {
      const ev = JSON.parse(l) as {
        type?: string;
        error?: {
          name?: string;
          message?: string;
          data?: { message?: string; statusCode?: number };
        };
      };
      if (ev.type !== 'error') continue;
      const msg =
        ev.error?.data?.message ?? ev.error?.message ?? ev.error?.name;
      const status = ev.error?.data?.statusCode;
      if (msg) return `${status ? `HTTP ${status}: ` : ''}${msg}`.slice(0, 300);
    } catch {
      /* linha de log */
    }
  }
  return null;
}

/**
 * Modelos de um endpoint compatível com a API da OpenAI (GET /models) —
 * chamado direto, sem passar pelo CLI (o CLI só listaria os modelos que a
 * própria conta já registrou no provider customizado).
 */
export async function listOpenAiModels(
  baseUrl: string,
  apiKey?: string,
): Promise<string[]> {
  if (!baseUrl.trim()) throw new Error('Informe a Base URL.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `HTTP ${res.status} ao listar modelos: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string }[];
    };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => !!id);
  } catch (err) {
    if ((err as Error).name === 'AbortError')
      throw new Error('Sem resposta em 15s.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
