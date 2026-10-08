import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  OpencodeBridgeService,
  parseOpencodeError,
  parseOpencodeJson,
  parseOpencodeUsage,
  renderSkillMd,
} from './opencode-bridge.service';
import { slugify } from './ai-agent.service';
import { brand, brandModel, sanitizeForUi } from './brand';
import { buildSkillAuthorPrompt, parseGeneratedSkill } from './skill-author';
import { GLOBAL_SKILL } from '../../common/llm/ai-agent-runtime';

describe('renderSkillMd', () => {
  it('gera frontmatter name/description e o corpo', () => {
    const md = renderSkillMd({
      slug: 'cobranca-pix',
      name: 'Cobrança via PIX',
      description: 'Quando o cliente pedir 2ª via: "pix"',
      body: '  Passo 1\nPasso 2  ',
    });
    expect(md.startsWith('---\nname: cobranca-pix\n')).toBe(true);
    expect(md).toContain(
      'description: "Quando o cliente pedir 2ª via: \\"pix\\""',
    );
    expect(md).toContain('# Cobrança via PIX');
    expect(md.trimEnd().endsWith('Passo 2')).toBe(true);
  });
});

describe('parseOpencodeJson', () => {
  it('junta os eventos de texto e ignora logs', () => {
    const out = [
      'INFO starting',
      JSON.stringify({ type: 'step_start' }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'Olá!' } }),
      JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Posso ajudar?' },
      }),
      '{quebrado',
    ].join('\n');
    expect(parseOpencodeJson(out)).toBe('Olá!\nPosso ajudar?');
  });
  it('vazio quando não há texto', () => {
    expect(parseOpencodeJson('INFO nada')).toBe('');
  });
});

describe('slugify', () => {
  it('normaliza acentos e símbolos', () => {
    expect(slugify('Cobrança & Negociação!')).toBe('cobranca-negociacao');
    expect(slugify('***')).toBe('skill');
  });
});

describe('GLOBAL_SKILL', () => {
  it('proíbe interação com código e vira SKILL.md válido', () => {
    expect(GLOBAL_SKILL.slug).toBe('regras-globais');
    const md = renderSkillMd(GLOBAL_SKILL);
    expect(md).toContain('name: regras-globais');
    expect(md).toContain('NUNCA interage com código');
    expect(md).toContain('blocos de código');
  });
});

describe('parseOpencodeError', () => {
  it('extrai o erro do provedor (saída 0 com evento de erro)', () => {
    const out = JSON.stringify({
      type: 'error',
      error: {
        name: 'APIError',
        data: { message: 'Error from provider: free tier', statusCode: 403 },
      },
    });
    expect(parseOpencodeError(out)).toBe(
      'HTTP 403: Error from provider: free tier',
    );
    expect(parseOpencodeError('INFO ok')).toBeNull();
  });
});

describe('skill-author', () => {
  it('o prompt inclui nome, descrição e proíbe código', () => {
    const p = buildSkillAuthorPrompt('Nina', 'Cobrança de boletos vencidos');
    expect(p).toContain('Nome: Nina');
    expect(p).toContain('Cobrança de boletos vencidos');
    expect(p).toContain('NÃO pode orientar nada relacionado a código');
  });
  it('parseGeneratedSkill tolera cercas e texto em volta', () => {
    const t =
      'Segue:\n```json\n{"name":"Cobrança","description":"Quando cobrar","body":"# Passos"}\n```';
    expect(parseGeneratedSkill(t)).toEqual({
      name: 'Cobrança',
      description: 'Quando cobrar',
      body: '# Passos',
    });
  });
  it('rejeita JSON ausente ou incompleto', () => {
    expect(() => parseGeneratedSkill('sem json')).toThrow();
    expect(() => parseGeneratedSkill('{"name":"x"}')).toThrow(/incompleta/);
  });
});

describe('parseOpencodeUsage', () => {
  it('soma tokens e custo dos step_finish', () => {
    const ev = (tokens: object, cost: number) =>
      JSON.stringify({ type: 'step_finish', part: { tokens, cost } });
    const out = [
      ev(
        { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 3 } },
        0.01,
      ),
      JSON.stringify({ type: 'text', part: { text: 'x' } }),
      ev(
        { input: 4, output: 6, reasoning: 0, cache: { read: 0, write: 0 } },
        0.02,
      ),
    ].join('\n');
    const u = parseOpencodeUsage(out);
    expect(u).toEqual({
      input: 14,
      output: 11,
      reasoning: 2,
      cacheRead: 1,
      cacheWrite: 3,
      cost: 0.03,
    });
  });
  it('zera quando não há eventos', () => {
    expect(parseOpencodeUsage('INFO').input).toBe(0);
  });
});

describe('brand', () => {
  it('troca OpenCode/Zen por IA Agent em mensagens exibidas ao usuário', () => {
    expect(
      brand(
        "HTTP 403: Error from provider: OpenCode's free tier ... OpenCode Zen, open-code",
      ),
    ).toBe(
      "HTTP 403: Error from provider: IA Agent's free tier ... IA Agent, IA Agent",
    );
    expect(brand(null)).toBe('');
  });
});

describe('brandModel / sanitizeForUi', () => {
  it('brandModel remove o prefixo interno do id de modelo', () => {
    expect(brandModel('opencode/big-pickle')).toBe('big-pickle');
    expect(brandModel('big-pickle')).toBe('big-pickle');
  });
  it('sanitizeForUi aplica brand() recursivamente e normaliza o campo model', () => {
    const out = sanitizeForUi({
      type: 'model_failed',
      model: 'opencode/big-pickle',
      error: "OpenCode's free tier only works inside OpenCode",
      nested: { note: 'opencode zen' },
    }) as Record<string, unknown>;
    expect(out.model).toBe('big-pickle');
    expect(out.error).toBe("IA Agent's free tier only works inside IA Agent");
    expect((out.nested as Record<string, unknown>).note).toBe('IA Agent');
  });
  it('corta strings muito longas', () => {
    const out = sanitizeForUi({ text: 'a'.repeat(5000) }) as Record<
      string,
      unknown
    >;
    expect((out.text as string).length).toBeLessThan(4100);
  });
});

describe('OpencodeBridgeService.reply (CLI falso, streaming)', () => {
  // Script Node com shebang que imita `opencode run --format json`, criado
  // no setup (não depende de nada fora do repositório/teste).
  const fakeBin = path.join(os.tmpdir(), `fake-opencode-${process.pid}.js`);

  beforeAll(async () => {
    const lines = [
      { type: 'step_start' },
      {
        type: 'reasoning',
        part: { type: 'reasoning', text: 'Pensando no pedido do cliente...' },
      },
      {
        type: 'tool_use',
        part: {
          type: 'tool',
          tool: 'utalks_erp_query',
          callID: 'c1',
          state: { status: 'running' },
        },
      },
      {
        type: 'tool_use',
        part: {
          type: 'tool',
          tool: 'utalks_erp_query',
          callID: 'c1',
          state: { status: 'completed', output: '{"rows":[]}' },
        },
      },
      {
        type: 'text',
        part: {
          type: 'text',
          text: '{"name":"Teste","description":"quando testar","body":"# Corpo"}',
        },
      },
      {
        type: 'step_finish',
        part: {
          tokens: {
            input: 10,
            output: 5,
            reasoning: 2,
            cache: { read: 0, write: 0 },
          },
          cost: 0.0001,
        },
      },
    ];
    const script = `#!/usr/bin/env node
const lines = ${JSON.stringify(lines)};
let i = 0;
const tick = () => {
  if (i >= lines.length) return process.exit(0);
  process.stdout.write(JSON.stringify(lines[i++]) + '\\n');
  setTimeout(tick, 5);
};
tick();
`;
    await fs.writeFile(fakeBin, script, { mode: 0o755 });
  });

  afterAll(async () => {
    await fs.rm(fakeBin, { force: true });
  });

  it('repassa eventos em tempo real, usa o provider customizado e devolve o texto final', async () => {
    const cfg = {
      get: (key: string) =>
        ({
          OPENCODE_BIN: fakeBin,
          OPENCODE_WORKSPACE_DIR: path.join(os.tmpdir(), 'ai-agent-test-ws'),
          OPENCODE_TIMEOUT_MS: 10_000,
        })[key],
    };
    const svc = new OpencodeBridgeService(cfg as never);
    const events: Record<string, unknown>[] = [];
    const r = await svc.reply({
      accountId: '11111111-1111-1111-1111-111111111111',
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: 'sk-teste',
      models: ['teste-modelo'],
      skills: [],
      systemPrompt: 'teste',
      history: [{ role: 'user', content: 'oi' }],
      onEvent: (ev) => events.push(ev),
    });
    expect(events.some((e) => e.type === 'model_start')).toBe(true);
    expect(events.some((e) => e.type === 'reasoning')).toBe(true);
    expect(events.some((e) => e.type === 'tool_use')).toBe(true);
    expect(events.some((e) => e.type === 'step_finish')).toBe(true);
    expect(r.usage.input).toBe(10);
    expect(JSON.parse(r.text)).toEqual({
      name: 'Teste',
      description: 'quando testar',
      body: '# Corpo',
    });
  }, 15000);
});
