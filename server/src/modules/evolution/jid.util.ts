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
  return jid.endsWith('@g.us');
}

export function digitsOf(jid: string): string {
  return normalizeJid(jid).split('@')[0].replace(/\D/g, '');
}

/**
 * Identificador do contato no app: `evolution:whatsapp:<número>` quando
 * há telefone; LID sem resolução mantém o sufixo para o envio saber que
 * não é um telefone (`evolution:whatsapp:<lid>@lid`).
 */
export function contactIdentifierFor(jid: string): string {
  const n = normalizeJid(jid);
  return n.endsWith('@lid')
    ? `evolution:whatsapp:${n.split('@')[0]}@lid`
    : `evolution:whatsapp:${n.split('@')[0]}`;
}

/** Telefone (só dígitos) quando o JID é um número; null para LID/grupo. */
export function phoneOf(jid: string): string | null {
  return isPnJid(jid) ? digitsOf(jid) : null;
}
