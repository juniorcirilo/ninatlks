/**
 * Avaliador de expressões JS restrito (sem `new Function`/`eval`).
 *
 * Usado nos mapeamentos de fontes de agente, cujo texto é digitado por um
 * admin da conta: executar isso como JavaScript daria RCE no processo da API.
 * Aqui só existem literais, identificadores do escopo, acesso a propriedade,
 * operadores comuns, ternário e chamada de funções/métodos de uma whitelist.
 */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string };

const OPS = [
  '===', '!==', '??', '&&', '||', '==', '!=', '<=', '>=', '?.',
  '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', '.', ',',
];

const BLOCKED_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

const STRING_METHODS = new Set([
  'toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd', 'slice',
  'substring', 'replace', 'replaceAll', 'split', 'padStart', 'padEnd',
  'startsWith', 'endsWith', 'includes', 'indexOf', 'charAt', 'toString',
  'concat', 'normalize',
]);
const NUMBER_METHODS = new Set(['toString', 'toFixed']);
const ARRAY_METHODS = new Set(['join', 'slice', 'includes', 'indexOf', 'at']);

const MAX_LEN = 500;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          i++;
          const e = src[i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : (e ?? '');
        } else s += src[i];
        i++;
      }
      if (src[i] !== c) throw new Error('string não terminada');
      i++;
      out.push({ t: 'str', v: s });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z0-9_$]+/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`caractere inválido: ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

type Fn = (...a: unknown[]) => unknown;

class Parser {
  private p = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly scope: Map<string, unknown>,
  ) {}

  run(): unknown {
    const v = this.ternary();
    if (this.p < this.toks.length) throw new Error('expressão inválida');
    return v;
  }

  private peekOp(...ops: string[]): string | null {
    const t = this.toks[this.p];
    return t?.t === 'op' && ops.includes(t.v) ? t.v : null;
  }
  private eat(op: string): void {
    if (this.peekOp(op) !== op) throw new Error(`esperado ${op}`);
    this.p++;
  }

  private ternary(): unknown {
    const c = this.binary(0);
    if (this.peekOp('?')) {
      this.p++;
      const a = this.ternary();
      this.eat(':');
      const b = this.ternary();
      return c ? a : b;
    }
    return c;
  }

  private static readonly LEVELS: string[][] = [
    ['??'], ['||'], ['&&'],
    ['===', '!==', '==', '!='],
    ['<', '>', '<=', '>='],
    ['+', '-'], ['*', '/', '%'],
  ];

  private binary(level: number): unknown {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    let op: string | null;
    while ((op = this.peekOp(...Parser.LEVELS[level]))) {
      this.p++;
      const right = this.binary(level + 1);
      /* eslint-disable @typescript-eslint/no-explicit-any, eqeqeq */
      const l = left as any, r = right as any;
      switch (op) {
        case '??': left = l ?? r; break;
        case '||': left = l || r; break;
        case '&&': left = l && r; break;
        case '===': left = l === r; break;
        case '!==': left = l !== r; break;
        case '==': left = l == r; break;
        case '!=': left = l != r; break;
        case '<': left = l < r; break;
        case '>': left = l > r; break;
        case '<=': left = l <= r; break;
        case '>=': left = l >= r; break;
        case '+': left = l + r; break;
        case '-': left = l - r; break;
        case '*': left = l * r; break;
        case '/': left = l / r; break;
        case '%': left = l % r; break;
      }
      /* eslint-enable */
    }
    return left;
  }

  private unary(): unknown {
    const op = this.peekOp('!', '-');
    if (op) {
      this.p++;
      const v = this.unary() as number;
      return op === '!' ? !v : -v;
    }
    return this.postfix();
  }

  private postfix(): unknown {
    let obj = this.primary();
    let thisArg: unknown = undefined;
    for (;;) {
      const op = this.peekOp('.', '?.', '[', '(');
      if (!op) return obj;
      this.p++;
      if (op === '.' || op === '?.') {
        if (op === '?.' && this.peekOp('[')) { this.p++; continue; }
        const t = this.toks[this.p++];
        if (t?.t !== 'id') throw new Error('propriedade inválida');
        thisArg = obj;
        obj = this.member(obj, t.v, op === '?.');
      } else if (op === '[') {
        const k = this.ternary();
        this.eat(']');
        thisArg = obj;
        obj = this.member(obj, String(k), false);
      } else {
        const args: unknown[] = [];
        if (!this.peekOp(')')) {
          do args.push(this.ternary()); while (this.peekOp(',') && ++this.p);
        }
        this.eat(')');
        if (typeof obj !== 'function') throw new Error('não é função');
        obj = (obj as Fn).apply(thisArg, args);
        thisArg = undefined;
      }
    }
  }

  private member(obj: unknown, key: string, optional: boolean): unknown {
    if (obj == null) {
      if (optional) return undefined;
      throw new Error('acesso em nulo');
    }
    if (BLOCKED_PROPS.has(key)) throw new Error('propriedade bloqueada');
    if (typeof obj === 'string') {
      if (key === 'length') return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      if (!STRING_METHODS.has(key)) throw new Error('método não permitido');
      return (String.prototype as any)[key];
    }
    if (typeof obj === 'number') {
      if (!NUMBER_METHODS.has(key)) throw new Error('método não permitido');
      return (Number.prototype as any)[key];
    }
    if (Array.isArray(obj)) {
      if (key === 'length') return obj.length;
      if (/^\d+$/.test(key)) return obj[Number(key)];
      if (!ARRAY_METHODS.has(key)) throw new Error('método não permitido');
      return (Array.prototype as any)[key];
    }
    if (typeof obj === 'object') {
      return Object.prototype.hasOwnProperty.call(obj, key)
        ? (obj as Record<string, unknown>)[key]
        : undefined;
    }
    return undefined;
  }

  private primary(): unknown {
    const t = this.toks[this.p++];
    if (!t) throw new Error('expressão incompleta');
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'id') {
      switch (t.v) {
        case 'true': return true;
        case 'false': return false;
        case 'null': return null;
        case 'undefined': return undefined;
      }
      return this.scope.get(t.v);
    }
    if (t.v === '(') {
      const v = this.ternary();
      this.eat(')');
      return v;
    }
    throw new Error(`token inesperado ${t.v}`);
  }
}

/** Lança em expressão inválida/proibida; o chamador decide o fallback. */
export function evalSafeExpression(
  expr: string,
  scope: Record<string, unknown>,
): unknown {
  if (expr.length > MAX_LEN) throw new Error('expressão longa demais');
  const map = new Map<string, unknown>(
    Object.entries(scope).filter(([k]) => !BLOCKED_PROPS.has(k)),
  );
  return new Parser(tokenize(expr), map).run();
}
