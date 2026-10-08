/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
   as tipagens públicas do @itsliaaa/baileys são `any` na maior parte da API de socket. */
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import pino from 'pino';
import * as QRCode from 'qrcode';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { useAtomicFileAuthState } from './auth-state';
import {
  type Baileys,
  type WASocket,
  WhatsAppError,
  loadBaileys,
} from './baileys';
import { WaStore } from './wa-store';

export type SessionStatus =
  'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface WaSession {
  channelId: string;
  accountId: string;
  name: string;
  dir: string;
  authDir: string;
  store: WaStore;
  sock: WASocket | null;
  status: SessionStatus;
  /** QR atual como data URL (PNG). */
  qr: string | null;
  pairingCode: string | null;
  phone: string | null;
  profileName: string | null;
  attempts: number;
  timer: NodeJS.Timeout | null;
  intentionallyStopped: boolean;
  starting: boolean;
  flushAuth: (() => Promise<void>) | null;
}

const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 5 * 60_000;
const VERSION_TTL_MS = 6 * 60 * 60_000;

/**
 * Dono de todos os sockets Baileys do processo (uma sessão por canal).
 * Layout em disco: <WA_SESSIONS_DIR>/<channelId>/{auth,storage}.
 *
 * Restrição: os sockets vivem neste processo; rode uma única réplica da API.
 */
@Injectable()
export class SessionManagerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessions = new Map<string, WaSession>();
  private readonly root: string;
  private readonly baileysLogger: pino.Logger;
  private version: { value: number[]; at: number } | null = null;
  private shuttingDown = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly gateway: RealtimeGateway,
  ) {
    this.root = this.config.get<string>('WA_SESSIONS_DIR') ?? '/data/sessions';
    this.baileysLogger = pino({
      level: this.config.get<string>('WA_LOG_LEVEL') ?? 'silent',
    });
  }

  // ─── ciclo de vida ─────────────────────────────────────────────────────

  /** Ligações dos eventos do socket (registradas pelo módulo de webhooks). */
  private readonly attachHandlers: ((
    s: WaSession,
    sock: WASocket,
    B: Baileys,
  ) => void)[] = [];

  addAttachHandler(
    fn: (s: WaSession, sock: WASocket, B: Baileys) => void,
  ): void {
    this.attachHandlers.push(fn);
  }

  // Bootstrap (e não OnModuleInit): garante que todos os handlers já se registraram.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await fs.mkdir(this.root, { recursive: true });
      const rows = await this.dataSource.query<
        { id: string; account_id: string; name: string }[]
      >(`SELECT * FROM public.wa_list_channels()`);
      for (const r of rows) {
        const s = this.ensure(r.id, r.account_id, r.name);
        const paired = await fs
          .access(path.join(s.authDir, 'creds.json'))
          .then(() => true)
          .catch(() => false);
        // Só reconecta quem já foi pareado; os demais esperam o usuário pedir o QR.
        if (paired) void this.start(r.id);
        else await this.persistState(s);
      }
      this.logger.log(
        `${rows.length} canal(is) WhatsApp carregado(s) de ${this.root}`,
      );
    } catch (err) {
      this.logger.error(
        `falha ao restaurar sessões: ${(err as Error).message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    // Nunca logout(): isso desvincularia o aparelho a cada deploy.
    await Promise.all(
      [...this.sessions.values()].map((s) => this.stop(s.channelId)),
    );
  }

  // ─── consulta ──────────────────────────────────────────────────────────

  get(channelId: string): WaSession | undefined {
    return this.sessions.get(channelId);
  }

  list(): WaSession[] {
    return [...this.sessions.values()];
  }

  /** Socket pronto para enviar; lança erro claro se a sessão não está conectada. */
  requireConnected(channelId: string): WaSession & { sock: WASocket } {
    const s = this.sessions.get(channelId);
    if (!s?.sock || s.status !== 'connected') {
      throw new WhatsAppError(
        'WhatsApp desconectado — reconecte a sessão em Configurações › WhatsApp.',
        'NOT_CONNECTED',
      );
    }
    return s as WaSession & { sock: WASocket };
  }

  // ─── operações ─────────────────────────────────────────────────────────

  /** Garante a entrada da sessão no mapa (sem conectar). */
  ensure(channelId: string, accountId: string, name: string): WaSession {
    let s = this.sessions.get(channelId);
    if (!s) {
      const dir = path.join(this.root, channelId);
      s = {
        channelId,
        accountId,
        name,
        dir,
        authDir: path.join(dir, 'auth'),
        store: new WaStore(path.join(dir, 'storage')),
        sock: null,
        status: 'disconnected',
        qr: null,
        pairingCode: null,
        phone: null,
        profileName: null,
        attempts: 0,
        timer: null,
        intentionallyStopped: false,
        starting: false,
        flushAuth: null,
      };
      this.sessions.set(channelId, s);
    } else {
      s.name = name;
    }
    return s;
  }

  async start(channelId: string): Promise<WaSession> {
    const s = this.sessions.get(channelId);
    if (!s) throw new WhatsAppError('sessão não encontrada');
    if (s.starting || (s.sock && s.status !== 'disconnected')) return s;

    s.starting = true;
    s.intentionallyStopped = false;
    this.clearTimer(s);
    try {
      const B = await loadBaileys();
      const { state, saveCreds, flush } = await useAtomicFileAuthState(
        s.authDir,
        B,
      );
      s.flushAuth = flush;
      await s.store.load();
      await fs
        .writeFile(
          path.join(s.dir, 'meta.json'),
          JSON.stringify({
            channelId,
            accountId: s.accountId,
            startedAt: new Date().toISOString(),
          }),
        )
        .catch(() => undefined);

      const version = await this.waVersion(B);
      const sock = B.makeWASocket({
        ...(version ? { version } : {}),
        logger: this.baileysLogger,
        browser: B.Browsers?.ubuntu?.('Chrome') ?? [
          'Ubuntu',
          'Chrome',
          '22.04.4',
        ],
        auth: {
          creds: state.creds,
          keys: B.makeCacheableSignalKeyStore(
            state.keys,
            this.baileysLogger,
            undefined,
          ),
        },
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        getMessage: (key: { id?: string | null }) =>
          Promise.resolve(s.store.getCached(key.id)?.message ?? undefined),
      });
      s.sock = sock;
      this.setStatus(s, 'connecting');

      sock.ev.on('creds.update', () => void saveCreds());
      sock.ev.on(
        'connection.update',
        (u: ConnectionUpdate) => void this.onConnection(s, B, u),
      );
      for (const attach of this.attachHandlers) attach(s, sock, B);
    } catch (err) {
      this.logger.error(`start ${channelId}: ${(err as Error).message}`);
      this.setStatus(s, 'disconnected');
      this.scheduleReconnect(s);
    } finally {
      s.starting = false;
    }
    return s;
  }

  /** Encerra o socket sem desvincular o aparelho. */
  async stop(channelId: string): Promise<void> {
    const s = this.sessions.get(channelId);
    if (!s) return;
    s.intentionallyStopped = true;
    this.clearTimer(s);
    const sock = s.sock;
    s.sock = null;
    try {
      sock?.ev.removeAllListeners('connection.update');
      sock?.end(undefined);
    } catch {
      /* já fechado */
    }
    await s.flushAuth?.().catch(() => undefined);
    await s.store.flush();
    if (!this.shuttingDown) this.setStatus(s, 'disconnected');
    else s.status = 'disconnected';
  }

  async restart(channelId: string): Promise<void> {
    await this.stop(channelId);
    const s = this.sessions.get(channelId);
    if (s) s.attempts = 0;
    await this.start(channelId);
  }

  /**
   * Limpa o cache do Baileys (contatos, grupos, LID) e força nova sincronização
   * com o WhatsApp, sem derrubar a sessão nem pedir novo QR.
   */
  async resync(channelId: string): Promise<{ groups: number }> {
    const s = this.sessions.get(channelId);
    if (!s) throw new WhatsAppError('Sessão não encontrada.', 'NOT_CONNECTED');
    await s.store.clear();
    if (s.status !== 'connected' || !s.sock) return { groups: 0 };
    const sock = s.sock as unknown as {
      groupFetchAllParticipating: () => Promise<
        Record<
          string,
          {
            id: string;
            subject?: string;
            size?: number;
            participants?: unknown[];
          }
        >
      >;
      resyncAppState?: (
        names: string[],
        isInitialSync: boolean,
      ) => Promise<void>;
    };
    let groups = 0;
    try {
      const map = await sock.groupFetchAllParticipating();
      s.store.replaceGroups(
        Object.values(map).map((g) => ({
          jid: g.id,
          name: g.subject || g.id,
          size: g.size ?? g.participants?.length ?? 0,
          picture: null,
          pictureAt: null,
        })),
      );
      groups = Object.keys(map).length;
    } catch (err) {
      this.logger.warn(`resync groups ${channelId}: ${(err as Error).message}`);
    }
    // Reenvia o estado do app (agenda/contatos) → eventos contacts.upsert/update.
    try {
      const B = await loadBaileys();
      await sock.resyncAppState?.(B.ALL_WA_PATCH_NAMES, true);
    } catch (err) {
      this.logger.warn(
        `resync app state ${channelId}: ${(err as Error).message}`,
      );
    }
    return { groups };
  }

  /** Desvincula o aparelho e apaga as credenciais (novo QR será necessário). */
  async logout(channelId: string): Promise<void> {
    const s = this.sessions.get(channelId);
    if (!s) return;
    try {
      await s.sock?.logout(undefined);
    } catch {
      /* já deslogado / offline */
    }
    await this.stop(channelId);
    await fs.rm(s.authDir, { recursive: true, force: true });
    s.phone = null;
    s.profileName = null;
    s.qr = null;
    s.pairingCode = null;
    this.setStatus(s, 'disconnected');
  }

  /** Remove a sessão e TODOS os dados dela do disco. */
  async remove(channelId: string): Promise<void> {
    await this.logout(channelId);
    const s = this.sessions.get(channelId);
    this.sessions.delete(channelId);
    if (s) await fs.rm(s.dir, { recursive: true, force: true });
  }

  /** Código de pareamento (alternativa ao QR): precisa do número com DDI. */
  async requestPairingCode(channelId: string, phone: string): Promise<string> {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10)
      throw new WhatsAppError('Informe o número com DDI e DDD.');
    let s = this.sessions.get(channelId);
    if (!s) throw new WhatsAppError('sessão não encontrada');
    if (s.status === 'connected')
      throw new WhatsAppError('Esta sessão já está conectada.');
    if (!s.sock) s = await this.start(channelId);

    // Espera o socket abrir o handshake (QR pronto ou conectando).
    for (
      let i = 0;
      i < 30 &&
      !(s.sock && (s.status === 'qr_ready' || s.status === 'connecting'));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!s.sock) throw new WhatsAppError('Não foi possível iniciar a sessão.');
    await new Promise((r) => setTimeout(r, 1500));
    const code = await s.sock.requestPairingCode(digits, undefined);
    s.pairingCode = code;
    this.emit(s);
    return code;
  }

  // ─── eventos do socket ─────────────────────────────────────────────────

  private async onConnection(
    s: WaSession,
    B: Baileys,
    u: ConnectionUpdate,
  ): Promise<void> {
    if (u.qr) {
      s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }).catch(
        () => null,
      );
      this.setStatus(s, 'qr_ready');
    }
    if (u.connection === 'connecting' && !u.qr && s.status !== 'qr_ready') {
      this.setStatus(s, 'connecting');
    }
    if (u.connection === 'open') {
      s.attempts = 0;
      s.qr = null;
      s.pairingCode = null;
      const user = s.sock?.user as { id?: string; name?: string } | undefined;
      s.phone = user?.id ? user.id.split(':')[0].split('@')[0] : s.phone;
      s.profileName = user?.name ?? s.profileName;
      this.setStatus(s, 'connected');
      void s.sock
        ?.sendPresenceUpdate('unavailable', undefined)
        .catch(() => undefined);
      return;
    }
    if (u.connection !== 'close') return;

    const code = (
      u.lastDisconnect?.error as
        { output?: { statusCode?: number } } | undefined
    )?.output?.statusCode;
    s.sock = null;
    s.qr = null;
    if (s.intentionallyStopped || this.shuttingDown) return;

    const D = B.DisconnectReason;
    if (code === D.loggedOut) {
      // Desvinculado pelo celular: credenciais inválidas, exige novo QR.
      await fs.rm(s.authDir, { recursive: true, force: true });
      s.phone = null;
      this.setStatus(s, 'disconnected');
      this.logger.warn(`${s.channelId}: desvinculado pelo aparelho`);
      return;
    }
    if (code === D.connectionReplaced || code === D.forbidden) {
      // Outra sessão assumiu / conta restrita: reconectar só pioraria.
      this.setStatus(s, 'disconnected');
      this.logger.warn(`${s.channelId}: sessão encerrada (código ${code})`);
      return;
    }
    if (code === D.restartRequired) {
      // Esperado logo após ler o QR: recria o socket mantendo as credenciais.
      this.setStatus(s, 'connecting');
      void this.start(s.channelId);
      return;
    }
    this.setStatus(s, 'disconnected');
    this.scheduleReconnect(s);
  }

  private scheduleReconnect(s: WaSession): void {
    if (s.intentionallyStopped || this.shuttingDown || s.timer) return;
    s.attempts += 1;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** (s.attempts - 1),
      RECONNECT_MAX_MS,
    );
    this.logger.warn(
      `${s.channelId}: reconectando em ${Math.round(delay / 1000)}s (tentativa ${s.attempts})`,
    );
    s.timer = setTimeout(() => {
      s.timer = null;
      if (s.intentionallyStopped || s.status === 'connected') return;
      void this.start(s.channelId);
    }, delay);
  }

  private clearTimer(s: WaSession): void {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  }

  private async waVersion(
    B: Baileys,
  ): Promise<[number, number, number] | null> {
    if (this.version && Date.now() - this.version.at < VERSION_TTL_MS) {
      return this.version.value as [number, number, number];
    }
    try {
      const { version } = await B.fetchLatestBaileysVersion();
      this.version = { value: version, at: Date.now() };
      return version as [number, number, number];
    } catch {
      return (
        (this.version?.value as [number, number, number] | undefined) ?? null
      );
    }
  }

  // ─── estado → banco + tempo real ───────────────────────────────────────

  private setStatus(s: WaSession, status: SessionStatus): void {
    const changed = s.status !== status;
    s.status = status;
    this.emit(s);
    if (changed) void this.persistState(s);
  }

  private emit(s: WaSession): void {
    this.gateway.emitSessionState(s.accountId, {
      channelId: s.channelId,
      status: s.status,
      qr: s.qr,
      pairingCode: s.pairingCode,
      phone: s.phone,
    });
  }

  private async persistState(s: WaSession): Promise<void> {
    try {
      await this.dataSource.query(
        `SELECT public.wa_set_channel_state($1,$2,$3,$4)`,
        [s.channelId, s.status, s.phone, s.profileName],
      );
    } catch (err) {
      this.logger.warn(
        `persistir estado ${s.channelId}: ${(err as Error).message}`,
      );
    }
  }
}

interface ConnectionUpdate {
  connection?: 'open' | 'connecting' | 'close';
  lastDisconnect?: { error?: unknown };
  qr?: string;
}
