/* eslint-disable @typescript-eslint/no-unsafe-argument --
   as tipagens públicas do @itsliaaa/baileys são `any` na maior parte da API de socket. */
import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import {
  SessionManagerService,
  type WaSession,
} from './session-manager.service';
import { WhatsAppService } from './whatsapp.service';
import { phoneOf } from './jid.util';

export interface DirectoryContact {
  jid: string;
  name: string | null;
  phone: string | null;
  picture: string | null;
}

export interface DirectoryGroup {
  jid: string;
  name: string;
  picture: string | null;
  size: number;
}

const PIC_TTL_MS = 24 * 60 * 60_000;
const PIC_BATCH = 60;
const PIC_CONCURRENCY = 4;
const GROUPS_TTL_MS = 60_000;

const groupsAt = new Map<string, number>();
const filling = new Set<string>();

/** Contatos e grupos do WhatsApp (do store da sessão), com foto carregada aos poucos. */
@Injectable({ scope: Scope.REQUEST })
export class WhatsAppDirectoryService {
  constructor(
    private readonly sessions: SessionManagerService,
    private readonly channels: WhatsAppService,
  ) {}

  private async session(accountId: string): Promise<WaSession> {
    const list = await this.channels.listChannels(accountId);
    const candidates = list
      .filter((c) => c.enabled)
      .map((c) => this.sessions.get(c.id))
      .filter((s): s is WaSession => !!s);
    const s = candidates.find((x) => x.status === 'connected') ?? candidates[0];
    if (!s) throw new NotFoundException('WhatsApp channel not configured');
    return s;
  }

  async contacts(accountId: string) {
    const s = await this.session(accountId);
    const now = Date.now();
    const all = [...s.store.contacts.values()];
    const stale = all.filter(
      (c) => !c.pictureAt || now - c.pictureAt > PIC_TTL_MS,
    );
    if (s.status === 'connected' && stale.length) {
      void this.fillPictures(
        s,
        stale.slice(0, PIC_BATCH).map((c) => c.jid),
        (jid, url) => s.store.setContactPicture(jid, url),
      );
    }
    const items: DirectoryContact[] = all
      .map((c) => ({
        jid: c.jid,
        name: c.name,
        phone: phoneOf(c.jid),
        picture: c.picture,
      }))
      .sort((a, b) =>
        (a.name ?? a.phone ?? a.jid).localeCompare(
          b.name ?? b.phone ?? b.jid,
          'pt-BR',
          {
            sensitivity: 'base',
          },
        ),
      );
    return { items, pending: Math.min(stale.length, PIC_BATCH) };
  }

  async groups(accountId: string) {
    const s = await this.session(accountId);
    if (
      s.status === 'connected' &&
      Date.now() - (groupsAt.get(s.channelId) ?? 0) > GROUPS_TTL_MS
    ) {
      groupsAt.set(s.channelId, Date.now());
      try {
        const map = (await s.sock!.groupFetchAllParticipating()) as Record<
          string,
          {
            id: string;
            subject?: string;
            size?: number;
            participants?: unknown[];
          }
        >;
        s.store.replaceGroups(
          Object.values(map).map((g) => ({
            jid: g.id,
            name: g.subject || g.id,
            size: g.size ?? g.participants?.length ?? 0,
            picture: null,
            pictureAt: null,
          })),
        );
      } catch {
        groupsAt.delete(s.channelId);
      }
    }
    const now = Date.now();
    const all = [...s.store.groups.values()];
    const stale = all.filter(
      (g) => !g.pictureAt || now - g.pictureAt > PIC_TTL_MS,
    );
    if (s.status === 'connected' && stale.length) {
      void this.fillPictures(
        s,
        stale.slice(0, PIC_BATCH).map((g) => g.jid),
        (jid, url) => s.store.setGroupPicture(jid, url),
      );
    }
    const items: DirectoryGroup[] = all
      .map((g) => ({
        jid: g.jid,
        name: g.name,
        picture: g.picture,
        size: g.size,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
      );
    return { items, pending: Math.min(stale.length, PIC_BATCH) };
  }

  /** Busca fotos em segundo plano (poucas por vez, para não irritar o WhatsApp). */
  private async fillPictures(
    s: WaSession,
    jids: string[],
    save: (jid: string, url: string | null) => void,
  ): Promise<void> {
    const lock = `${s.channelId}:${jids[0]}`;
    if (filling.has(s.channelId)) return;
    filling.add(s.channelId);
    void lock;
    try {
      const queue = [...jids];
      const worker = async () => {
        for (let jid = queue.shift(); jid; jid = queue.shift()) {
          if (!s.sock || s.status !== 'connected') return;
          try {
            save(jid, (await s.sock.profilePictureUrl(jid, 'image')) ?? null);
          } catch {
            save(jid, null);
          }
        }
      };
      await Promise.all(Array.from({ length: PIC_CONCURRENCY }, worker));
    } finally {
      filling.delete(s.channelId);
    }
  }
}
