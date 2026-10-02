import { Injectable, NotFoundException, Scope } from '@nestjs/common';
import {
  EvolutionClientService,
  type RemoteChat,
} from './evolution-client.service';
import { EvolutionService } from './evolution.service';
import {
  isGroupJid,
  isLidJid,
  isPnJid,
  normalizeJid,
  phoneOf,
} from './jid.util';

export interface DirectoryContact {
  /** JID de telefone quando resolvido; LID caso contrário. */
  jid: string;
  name: string | null;
  phone: string | null;
  picture: string | null;
  /** true quando o JID original era LID e foi resolvido para o telefone. */
  resolved_lid: boolean;
}

export interface DirectoryGroup {
  jid: string;
  name: string;
  picture: string | null;
  size: number;
}

interface CacheEntry<T> {
  at: number;
  data: T;
}

const TTL_MS = 60_000;
// Cache por processo (o service é request-scoped; o Map vive no módulo).
const contactsCache = new Map<string, CacheEntry<DirectoryContact[]>>();
const groupsCache = new Map<string, CacheEntry<DirectoryGroup[]>>();

/** Contatos e grupos do WhatsApp (via Evolution), com foto e LID resolvido. */
@Injectable({ scope: Scope.REQUEST })
export class EvolutionDirectoryService {
  constructor(
    private readonly evolution: EvolutionService,
    private readonly client: EvolutionClientService,
  ) {}

  private async target(accountId: string) {
    const channels = await this.evolution.listChannels(accountId);
    const channel = channels.find((c) => {
      const cfg = c.config as Record<string, string> | null;
      return (
        c.enabled &&
        cfg?.evolution_url &&
        cfg.evolution_api_key &&
        cfg.evolution_instance_name
      );
    });
    if (!channel)
      throw new NotFoundException('WhatsApp channel not configured');
    const cfg = channel.config as Record<string, string>;
    return {
      id: channel.id,
      args: {
        url: cfg.evolution_url,
        apiKey: cfg.evolution_api_key,
        instanceName: cfg.evolution_instance_name,
      },
    };
  }

  /** lid → telefone, aprendido dos chats (remoteJidAlt da última mensagem). */
  private lidMap(chats: RemoteChat[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const c of chats) {
      const key = c.lastMessage?.key;
      const alt = key?.remoteJidAlt;
      if (!alt) continue;
      const main = normalizeJid(c.remoteJid);
      const other = normalizeJid(alt);
      if (isLidJid(main) && isPnJid(other)) map.set(main, other);
      else if (isPnJid(main) && isLidJid(other)) map.set(other, main);
    }
    return map;
  }

  async contacts(accountId: string, refresh = false) {
    const t = await this.target(accountId);
    const hit = contactsCache.get(t.id);
    if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.data;

    const [contacts, chats] = await Promise.all([
      this.client.findContacts(t.args),
      this.client.findChats(t.args).catch(() => [] as RemoteChat[]),
    ]);
    const lids = this.lidMap(chats);

    // Nome/foto que só aparecem nos chats (pushName da última mensagem recebida).
    const chatInfo = new Map<
      string,
      { name: string | null; pic: string | null }
    >();
    for (const c of chats) {
      const jid = normalizeJid(c.remoteJid);
      const msg = c.lastMessage;
      chatInfo.set(jid, {
        name:
          c.pushName || (msg && !msg.key?.fromMe ? msg.pushName : null) || null,
        pic: c.profilePicUrl || null,
      });
    }

    const merged = new Map<string, DirectoryContact>();
    const add = (rawJid: string, name?: string | null, pic?: string | null) => {
      const original = normalizeJid(rawJid);
      if (isGroupJid(original) || original.includes('@broadcast')) return;
      const jid = lids.get(original) ?? original;
      const info = chatInfo.get(original) ?? chatInfo.get(jid);
      const prev = merged.get(jid);
      merged.set(jid, {
        jid,
        name: prev?.name || name || info?.name || null,
        phone: phoneOf(jid),
        picture: prev?.picture || pic || info?.pic || null,
        resolved_lid: prev?.resolved_lid || jid !== original,
      });
    };
    for (const c of contacts) add(c.remoteJid, c.pushName, c.profilePicUrl);
    for (const c of chats) add(c.remoteJid, null, null);

    const data = [...merged.values()].sort((a, b) =>
      (a.name ?? a.phone ?? a.jid).localeCompare(
        b.name ?? b.phone ?? b.jid,
        'pt-BR',
        {
          sensitivity: 'base',
        },
      ),
    );
    contactsCache.set(t.id, { at: Date.now(), data });
    return data;
  }

  async groups(accountId: string, refresh = false) {
    const t = await this.target(accountId);
    const hit = groupsCache.get(t.id);
    if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.data;

    const list = await this.client.fetchAllGroups(t.args);
    const data: DirectoryGroup[] = list
      .map((g) => ({
        jid: g.id,
        name: g.subject || g.id,
        picture: g.pictureUrl || null,
        size: g.size ?? 0,
      }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
      );
    groupsCache.set(t.id, { at: Date.now(), data });
    return data;
  }
}
