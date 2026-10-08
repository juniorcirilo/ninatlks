import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isLidJid, isPnJid, normalizeJid } from './jid.util';
import type { WAMessage } from './baileys';

export interface StoredContact {
  jid: string;
  name: string | null;
  /** foto (URL pps.whatsapp.net) e quando foi consultada */
  picture: string | null;
  pictureAt: number | null;
}

export interface StoredGroup {
  jid: string;
  name: string;
  size: number;
  picture: string | null;
  pictureAt: number | null;
}

const MAX_SENT_CACHE = 500;
const SAVE_DEBOUNCE_MS = 2_000;

/**
 * Cache de diretório de UMA sessão (`<sessão>/storage/*.json`):
 * contatos, grupos e mapa LID→telefone. O Baileys não entrega "lista de
 * contatos" sob demanda; ela vem dos eventos e é guardada aqui.
 * Também mantém um LRU em memória das mensagens recentes — enviadas (para
 * `getMessage`, usado pelo Baileys no retry) e recebidas (o Baileys também
 * chama `getMessage` para decifrar a edição de uma mensagem do contato,
 * buscando a mensagem ORIGINAL para extrair seu `messageContextInfo.messageSecret`).
 */
export class WaStore {
  readonly contacts = new Map<string, StoredContact>();
  readonly groups = new Map<string, StoredGroup>();
  readonly lidToPn = new Map<string, string>();
  private readonly sent = new Map<string, WAMessage>();
  private timer: NodeJS.Timeout | null = null;
  private dirty = new Set<'contacts' | 'groups' | 'lid'>();

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const read = async <T>(name: string): Promise<T | null> => {
      try {
        return JSON.parse(
          await fs.readFile(path.join(this.dir, name), 'utf8'),
        ) as T;
      } catch {
        return null;
      }
    };
    for (const c of (await read<StoredContact[]>('contacts.json')) ?? [])
      this.contacts.set(c.jid, c);
    for (const g of (await read<StoredGroup[]>('groups.json')) ?? [])
      this.groups.set(g.jid, g);
    const lid = (await read<Record<string, string>>('lid-map.json')) ?? {};
    for (const [k, v] of Object.entries(lid)) this.lidToPn.set(k, v);
  }

  /** Incrementa a cada `clear()`; quem guarda "já consultei" por contato usa para invalidar. */
  epoch = 0;

  /**
   * Zera o cache em memória (contatos, grupos, mapa LID→telefone, mensagens
   * enviadas) e apaga os JSON de `storage/`. NÃO toca nas credenciais (`auth/`).
   */
  async clear(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty.clear();
    this.contacts.clear();
    this.groups.clear();
    this.lidToPn.clear();
    this.sent.clear();
    this.epoch++;
    for (const f of ['contacts.json', 'groups.json', 'lid-map.json']) {
      await fs.rm(path.join(this.dir, f), { force: true });
    }
  }

  // ─── LID ───────────────────────────────────────────────────────────────

  mapLid(lid: string, pn: string): void {
    const l = normalizeJid(lid);
    const p = normalizeJid(pn);
    if (!isLidJid(l) || !isPnJid(p) || this.lidToPn.get(l) === p) return;
    this.lidToPn.set(l, p);
    this.touch('lid');
  }

  /** Telefone de um LID (ou o próprio JID se já for telefone/desconhecido). */
  resolve(jid: string): string {
    const n = normalizeJid(jid);
    return isLidJid(n) ? (this.lidToPn.get(n) ?? n) : n;
  }

  // ─── contatos / grupos ────────────────────────────────────────────────

  upsertContact(
    rawJid: string,
    patch: { name?: string | null; picture?: string | null },
  ): void {
    const jid = this.resolve(rawJid);
    if (jid.endsWith('@g.us') || jid.includes('@broadcast')) return;
    const prev = this.contacts.get(jid);
    const next: StoredContact = {
      jid,
      name: patch.name || prev?.name || null,
      picture: patch.picture ?? prev?.picture ?? null,
      pictureAt: prev?.pictureAt ?? null,
    };
    if (prev && prev.name === next.name && prev.picture === next.picture)
      return;
    this.contacts.set(jid, next);
    this.touch('contacts');
  }

  setContactPicture(jid: string, picture: string | null): void {
    const c = this.contacts.get(this.resolve(jid));
    if (!c) return;
    c.picture = picture;
    c.pictureAt = Date.now();
    this.touch('contacts');
  }

  replaceGroups(list: StoredGroup[]): void {
    const keep = new Map(this.groups);
    this.groups.clear();
    for (const g of list) {
      const prev = keep.get(g.jid);
      this.groups.set(g.jid, {
        ...g,
        picture: prev?.picture ?? g.picture,
        pictureAt: prev?.pictureAt ?? null,
      });
    }
    this.touch('groups');
  }

  setGroupPicture(jid: string, picture: string | null): void {
    const g = this.groups.get(jid);
    if (!g) return;
    g.picture = picture;
    g.pictureAt = Date.now();
    this.touch('groups');
  }

  // ─── mensagens recentes (retry / decifrar edição) ─────────────────────

  remember(id: string | null | undefined, msg: WAMessage): void {
    if (!id) return;
    this.sent.set(id, msg);
    if (this.sent.size > MAX_SENT_CACHE) {
      const oldest: string | undefined = this.sent.keys().next().value as
        string | undefined;
      if (oldest) this.sent.delete(oldest);
    }
  }

  getCached(id: string | null | undefined): WAMessage | undefined {
    return id ? this.sent.get(id) : undefined;
  }

  // ─── persistência ─────────────────────────────────────────────────────

  private touch(what: 'contacts' | 'groups' | 'lid'): void {
    this.dirty.add(what);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const todo = [...this.dirty];
    this.dirty.clear();
    const write = async (name: string, data: unknown) => {
      const file = path.join(this.dir, name);
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data));
      await fs.rename(tmp, file);
    };
    try {
      await fs.mkdir(this.dir, { recursive: true });
      for (const w of todo) {
        if (w === 'contacts')
          await write('contacts.json', [...this.contacts.values()]);
        if (w === 'groups')
          await write('groups.json', [...this.groups.values()]);
        if (w === 'lid')
          await write('lid-map.json', Object.fromEntries(this.lidToPn));
      }
    } catch {
      // Cache: perder uma gravação não compromete a sessão.
    }
  }
}
