// Helpers de JID do WhatsApp. Contatos podem chegar como número
// (`5511999999999@s.whatsapp.net`) ou como LID (`123456789@lid`, id anônimo);
// o app sempre prefere o número e só cai no LID quando não há como resolver.

export const PN_SUFFIX = '@s.whatsapp.net';

/** Remove o sufixo de dispositivo (`:12`) do JID. */
export function normalizeJid(jid: string): string {
  return jid.trim().replace(/:\d+@/, '@');
}

export function isLidJid(jid: string): boolean {
  return normalizeJid(jid).endsWith('@lid');
}

export function isPnJid(jid: string): boolean {
  return normalizeJid(jid).endsWith(PN_SUFFIX);
}

export function isGroupJid(jid: string): boolean {
  return normalizeJid(jid).endsWith('@g.us');
}

export function digitsOf(jid: string): string {
  return normalizeJid(jid).split('@')[0].replace(/\D/g, '');
}

/**
 * Identificador do contato no app: `evolution:whatsapp:<número>` quando
 * há telefone; LID sem resolução mantém o sufixo para o envio saber que
 * não é um telefone (`evolution:whatsapp:<lid>@lid`); grupos mantêm `@g.us`.
 */
export function contactIdentifierFor(jid: string): string {
  const n = normalizeJid(jid);
  if (n.endsWith('@lid') || n.endsWith('@g.us'))
    return `evolution:whatsapp:${n}`;
  return `evolution:whatsapp:${n.split('@')[0]}`;
}

/** Destino de envio (número, `<lid>@lid` ou `<id>@g.us`) a partir do identifier do contato. */
export function extractTarget(
  identifier: string | null | undefined,
): string | null {
  const m = /evolution:whatsapp:(\d+(?:-\d+)?(?:@lid|@g\.us)?)/.exec(
    identifier ?? '',
  );
  return m ? m[1] : null;
}

/**
 * JID de destino/armazenamento: sempre `@s.whatsapp.net` (LID resolvido pelo
 * mapa aprendido); grupos ficam `@g.us`; LID sem mapeamento fica como veio.
 */
export function toPnJid(
  jid: string,
  lidToPn?: { get(lid: string): string | undefined },
): string {
  const n = normalizeJid(jid);
  if (isGroupJid(n)) return n;
  if (isLidJid(n)) return lidToPn?.get(n) ?? n;
  if (n.includes('@')) return n;
  return `${n.replace(/\D/g, '')}${PN_SUFFIX}`;
}

/** Telefone (só dígitos) quando o JID é um número; null para LID/grupo. */
export function phoneOf(jid: string): string | null {
  return isPnJid(jid) ? digitsOf(jid) : null;
}
