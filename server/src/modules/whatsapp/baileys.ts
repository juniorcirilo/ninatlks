import type * as BaileysTypes from '@itsliaaa/baileys';

/** O pacote é ESM-only e a API compila para CJS: import dinâmico, em cache. */
export type Baileys = typeof BaileysTypes;
export type WASocket = ReturnType<Baileys['makeWASocket']>;
export type WAMessage = BaileysTypes.proto.IWebMessageInfo;

let cached: Promise<Baileys> | null = null;

export function loadBaileys(): Promise<Baileys> {
  cached ??= import('@itsliaaa/baileys') as Promise<Baileys>;
  return cached;
}

/** Erro de envio/sessão do WhatsApp (mensagem segura para mostrar na UI). */
export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code:
      'NOT_CONNECTED' | 'NOT_ON_WHATSAPP' | 'SEND_FAILED' = 'SEND_FAILED',
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}
