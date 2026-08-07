/**
 * Substituição simples `{{chave}}` — usado hoje pelo step WhatsApp de
 * cadência (server/src/modules/jobs/processors/cadence-tick.processor.ts).
 * Chaves não encontradas em `vars` são removidas (não deixa `{{lixo}}` vazar
 * pra mensagem final).
 */
export function renderTemplate(
  text: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? '' : String(value);
  });
}
