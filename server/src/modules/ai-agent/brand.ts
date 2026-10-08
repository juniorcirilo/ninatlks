/**
 * Marca exibida ao usuário: o motor do agente aparece sempre como "IA Agent".
 * Mensagens (inclusive erros do CLI/provedor) passam por aqui antes de chegar
 * à tela.
 */
export const AGENT_BRAND = 'IA Agent';

export function brand(text: string | null | undefined): string {
  return (text ?? '').replace(/open[\s-]?code(?:\s+zen)?/gi, AGENT_BRAND);
}

const MAX_STRING = 4000;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;

/** Remove o prefixo interno "opencode/" de um id de modelo (ex.: "opencode/big-pickle" → "big-pickle"). */
export function brandModel(model: string | null | undefined): string {
  return (model ?? '').replace(/^opencode\//i, '');
}

/**
 * Sanitiza um evento do motor antes de expô-lo à tela: nenhuma string chega
 * sem passar por `brand()`, ids de modelo perdem o prefixo interno, e textos
 * longos/estruturas profundas são cortados (os eventos do CLI podem trazer
 * saídas de ferramentas arbitrariamente grandes).
 */
export function sanitizeForUi(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const b = brand(value);
    return b.length > MAX_STRING ? `${b.slice(0, MAX_STRING)}…` : b;
  }
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => sanitizeForUi(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] =
      k === 'model' && typeof v === 'string'
        ? brand(brandModel(v))
        : sanitizeForUi(v, depth + 1);
  }
  return out;
}
