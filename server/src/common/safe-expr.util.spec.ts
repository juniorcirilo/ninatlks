import { evalSafeExpression as ev } from './safe-expr.util';

describe('evalSafeExpression', () => {
  const upper = (s: string) => s.toUpperCase();
  const scope = { nome: 'Ana', c: { fone: '11 9' }, upper };

  it('avalia expressões comuns', () => {
    expect(ev('upper(nome)', scope)).toBe('ANA');
    expect(ev('nome.toLowerCase()', scope)).toBe('ana');
    expect(ev("nome + ' ' + c.fone", scope)).toBe('Ana 11 9');
    expect(ev("x ?? 'n/a'", scope)).toBe('n/a');
    expect(ev("nome === 'Ana' ? 1 : 2", scope)).toBe(1);
  });

  it.each([
    "nome.constructor.constructor('return process')()",
    '__proto__',
    "this.constructor",
    "process.exit()",
    "nome['constructor']",
    'require("fs")',
  ])('bloqueia %s', (e) => {
    let out: unknown;
    try { out = ev(e, scope); } catch { out = 'threw'; }
    expect(['threw', undefined]).toContain(out);
  });
});
