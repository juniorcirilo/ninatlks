/**
 * Sem WEB_ORIGIN em produção a web é same-origin (nginx) — não emite CORS.
 * `origin: true` com credentials refletiria qualquer site; só em dev.
 */
export function webOrigin(): string | boolean {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN;
  return process.env.NODE_ENV !== 'production';
}
