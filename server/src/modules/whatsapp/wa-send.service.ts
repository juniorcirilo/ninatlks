/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument --
   as tipagens públicas do @itsliaaa/baileys são `any` na maior parte da API de socket. */
import { Injectable } from '@nestjs/common';
import { WhatsAppError } from './baileys';
import { SessionManagerService } from './session-manager.service';
import { isLidJid, normalizeJid } from './jid.util';

const PRESENCE_RESUB_MS = 4 * 60 * 1000;

/** Mensagem citada (resposta). */
export interface QuotedRef {
  key: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    /** autor da mensagem citada (obrigatório em grupos) */
    participant?: string;
  };
  message?: { conversation: string };
}

export interface InteractiveButton {
  type: 'reply' | 'url' | 'copy' | 'call';
  displayText: string;
  id?: string;
  url?: string;
  copyCode?: string;
  phoneNumber?: string;
}

export interface InteractiveSection {
  title: string;
  rows: { title: string; rowId: string; description?: string }[];
}

export type InteractiveContent =
  | {
      kind: 'buttons';
      title: string;
      description: string;
      footer?: string;
      buttons: InteractiveButton[];
      /** Cabeçalho de imagem/vídeo (força native flow). */
      media?: { kind: 'image' | 'video'; buffer: Buffer; mimetype: string };
    }
  | {
      kind: 'list';
      title: string;
      description?: string;
      footer?: string;
      buttonText: string;
      sections: InteractiveSection[];
    };

export type SendMediaType = 'image' | 'video' | 'document' | 'audio';

const EXISTS_TTL_MS = 60 * 60_000;

/** Envio de mensagens por sessão (substitui o antigo EvolutionClientService). */
@Injectable()
export class WaSendService {
  private readonly existsCache = new Map<string, { jid: string; at: number }>();

  constructor(private readonly sessions: SessionManagerService) {}

  /**
   * Destino → JID. Número puro é validado no WhatsApp (resolve o 9º dígito
   * do Brasil etc.); JID completo (inclusive `@lid`) é usado como veio.
   */
  async resolveJid(channelId: string, number: string): Promise<string> {
    const raw = number.trim();
    if (raw.includes('@')) return normalizeJid(raw);
    const digits = raw.replace(/\D/g, '');
    if (!digits) throw new WhatsAppError('Número de destino inválido.');

    const key = `${channelId}:${digits}`;
    const hit = this.existsCache.get(key);
    if (hit && Date.now() - hit.at < EXISTS_TTL_MS) return hit.jid;

    const { sock } = this.sessions.requireConnected(channelId);
    const [r] =
      (await sock
        .onWhatsApp(`${digits}@s.whatsapp.net`)
        .catch(() => undefined)) ?? [];
    if (r && !r.exists) {
      throw new WhatsAppError(
        'Este número não tem WhatsApp.',
        'NOT_ON_WHATSAPP',
      );
    }
    // Se a consulta falhar (sem resposta), tenta enviar mesmo assim.
    const jid = normalizeJid(r?.jid ?? `${digits}@s.whatsapp.net`);
    this.existsCache.set(key, { jid, at: Date.now() });
    return jid;
  }

  private async deliver(
    channelId: string,
    number: string,
    build: (jid: string) => Record<string, unknown>,
    quoted?: QuotedRef,
  ): Promise<{ messageId?: string }> {
    const session = this.sessions.requireConnected(channelId);
    const jid = await this.resolveJid(channelId, number);
    try {
      const sent = await session.sock.sendMessage(
        jid,
        build(jid),
        quoted ? { quoted } : undefined,
      );
      if (sent) session.store.remember(sent.key?.id, sent);
      return { messageId: sent?.key?.id ?? undefined };
    } catch (err) {
      throw new WhatsAppError(
        (err as Error).message || 'Falha ao enviar pelo WhatsApp.',
        'SEND_FAILED',
      );
    }
  }

  sendText(args: {
    channelId: string;
    number: string;
    text: string;
    quoted?: QuotedRef;
  }) {
    return this.deliver(
      args.channelId,
      args.number,
      () => ({ text: args.text }),
      args.quoted,
    );
  }

  /** Envia o recibo de leitura (tique azul) das mensagens recebidas. */
  async markRead(
    channelId: string,
    number: string,
    keys: { id: string; participant?: string }[],
  ): Promise<void> {
    if (!keys.length) return;
    const { sock } = this.sessions.requireConnected(channelId);
    const jid = await this.resolveJid(channelId, number);
    await sock.readMessages(
      keys.map((k) => ({
        remoteJid: jid,
        id: k.id,
        fromMe: false,
        participant: k.participant,
      })),
    );
  }

  /** Edita o texto de uma mensagem enviada por nós (janela de ~15 min do WhatsApp). */
  async editText(args: {
    channelId: string;
    number: string;
    messageId: string;
    text: string;
  }): Promise<void> {
    const { sock } = this.sessions.requireConnected(args.channelId);
    const jid = await this.resolveJid(args.channelId, args.number);
    try {
      await sock.sendMessage(jid, {
        text: args.text,
        edit: { remoteJid: jid, fromMe: true, id: args.messageId },
      });
    } catch (err) {
      throw new WhatsAppError(
        (err as Error).message || 'Falha ao editar a mensagem.',
        'SEND_FAILED',
      );
    }
  }

  /** Apaga para todos uma mensagem enviada por nós. */
  async revoke(args: {
    channelId: string;
    number: string;
    messageId: string;
  }): Promise<void> {
    const { sock } = this.sessions.requireConnected(args.channelId);
    const jid = await this.resolveJid(args.channelId, args.number);
    try {
      await sock.sendMessage(jid, {
        delete: { remoteJid: jid, fromMe: true, id: args.messageId },
      });
    } catch (err) {
      throw new WhatsAppError(
        (err as Error).message || 'Falha ao apagar a mensagem.',
        'SEND_FAILED',
      );
    }
  }

  sendMedia(args: {
    channelId: string;
    number: string;
    mediatype: SendMediaType;
    mimetype: string;
    buffer: Buffer;
    fileName?: string;
    caption?: string;
    quoted?: QuotedRef;
  }) {
    return this.deliver(
      args.channelId,
      args.number,
      () => {
        switch (args.mediatype) {
          case 'image':
            return {
              image: args.buffer,
              caption: args.caption,
              mimetype: args.mimetype,
            };
          case 'video':
            return {
              video: args.buffer,
              caption: args.caption,
              mimetype: args.mimetype,
            };
          case 'audio':
            return {
              audio: args.buffer,
              mimetype: args.mimetype,
              // Nota de voz só para ogg/opus; outros formatos vão como arquivo de áudio.
              ptt: /ogg|opus/i.test(args.mimetype),
            };
          default:
            return {
              document: args.buffer,
              mimetype: args.mimetype,
              fileName: args.fileName ?? 'arquivo',
              caption: args.caption,
            };
        }
      },
      args.quoted,
    );
  }

  sendInteractive(args: {
    channelId: string;
    number: string;
    content: InteractiveContent;
    quoted?: QuotedRef;
  }) {
    return this.deliver(
      args.channelId,
      args.number,
      () => toInteractivePayload(args.content),
      args.quoted,
    );
  }

  sendContact(args: {
    channelId: string;
    number: string;
    name: string;
    phone: string;
    org?: string;
    quoted?: QuotedRef;
  }) {
    const digits = args.phone.replace(/\D/g, '');
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${args.name}`,
      ...(args.org ? [`ORG:${args.org};`] : []),
      `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
      'END:VCARD',
    ].join('\n');
    return this.deliver(
      args.channelId,
      args.number,
      () => ({ contacts: { displayName: args.name, contacts: [{ vcard }] } }),
      args.quoted,
    );
  }

  /** Assinaturas de presença por socket (um socket novo começa do zero). */
  private readonly presenceSubs = new WeakMap<object, Map<string, number>>();

  /**
   * Assina a presença do contato (digitando/online). A assinatura do
   * WhatsApp expira, então renova a cada `PRESENCE_RESUB_MS`.
   */
  async subscribePresence(channelId: string, number: string): Promise<void> {
    const { sock } = this.sessions.requireConnected(channelId);
    const jid = await this.resolveJid(channelId, number);
    if (jid.endsWith('@g.us')) return;
    let subs = this.presenceSubs.get(sock);
    if (!subs) this.presenceSubs.set(sock, (subs = new Map()));
    if (Date.now() - (subs.get(jid) ?? 0) < PRESENCE_RESUB_MS) return;
    // O WhatsApp só entrega a presença dos outros a quem está "disponível"
    // (com markOnlineOnConnect:false a sessão fica invisível e recebe nada).
    if (subs.size === 0) await sock.sendPresenceUpdate('available', undefined);
    subs.set(jid, Date.now());
    try {
      await sock.presenceSubscribe(jid);
    } catch (err) {
      subs.delete(jid);
      throw err;
    }
  }

  /** "digitando…" / "gravando…" para o contato (melhor esforço). */
  async sendPresence(args: {
    channelId: string;
    number: string;
    presence: 'composing' | 'recording' | 'paused' | 'available';
  }): Promise<void> {
    const { sock } = this.sessions.requireConnected(args.channelId);
    const jid = await this.resolveJid(args.channelId, args.number);
    await sock.sendPresenceUpdate(args.presence, jid);
  }

  /** URL da foto de perfil; null se o contato não tem foto ou a ocultou. */
  async profilePictureUrl(
    channelId: string,
    jid: string,
  ): Promise<string | null> {
    const { sock } = this.sessions.requireConnected(channelId);
    try {
      return (await sock.profilePictureUrl(normalizeJid(jid), 'image')) ?? null;
    } catch {
      return null;
    }
  }

  isLid(jid: string): boolean {
    return isLidJid(jid);
  }
}

/** Conteúdo interativo → formato do fork `@itsliaaa/baileys`. */
export function toInteractivePayload(
  c: InteractiveContent,
): Record<string, unknown> {
  if (c.kind === 'list') {
    return {
      text: c.description || c.title,
      title: c.title,
      footer: c.footer,
      buttonText: c.buttonText,
      sections: c.sections.map((s) => ({
        title: s.title,
        rows: s.rows.map((r) => ({
          title: r.title,
          description: r.description,
          rowId: r.rowId,
        })),
      })),
    };
  }

  const text = `*${c.title}*\n${c.description}`.trim();
  const onlyReplies = c.buttons.every((b) => b.type === 'reply');
  if (onlyReplies && !c.media) {
    return {
      text,
      footer: c.footer,
      buttons: c.buttons.map((b) => ({
        text: b.displayText,
        id: b.id ?? b.displayText,
      })),
    };
  }
  // Link / ligar / copiar (e qualquer botão com mídia) exigem native flow.
  const nativeFlow = c.buttons.map((b) => {
    switch (b.type) {
      case 'url':
        return { text: b.displayText, url: b.url };
      case 'call':
        return { text: b.displayText, call: b.phoneNumber };
      case 'copy':
        return { text: b.displayText, copy: b.copyCode };
      default:
        return { text: b.displayText, id: b.id ?? b.displayText };
    }
  });
  if (c.media) {
    return {
      [c.media.kind]: c.media.buffer,
      mimetype: c.media.mimetype,
      caption: text,
      footer: c.footer,
      nativeFlow,
    };
  }
  return { text, footer: c.footer, nativeFlow };
}
