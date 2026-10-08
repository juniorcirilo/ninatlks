import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { Channels } from '../../database/entities/voice/channels.entity';
import { Inboxes } from '../../database/entities/voice/inboxes.entity';
import {
  SessionManagerService,
  type WaSession,
} from './session-manager.service';

const QR_WAIT_MS = 10_000;

/** Ciclo de vida dos canais WhatsApp (por conta): criar, QR, status, apagar. */
@Injectable({ scope: Scope.REQUEST })
export class WhatsAppService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly sessions: SessionManagerService,
  ) {}

  listChannels(accountId: string) {
    return this.tx.manager.find(Channels, {
      where: { accountId, channelType: 'whatsapp' },
      select: { id: true, name: true, config: true, enabled: true },
      order: { createdAt: 'DESC' },
    });
  }

  private async channelOf(accountId: string, channelId: string) {
    const channel = await this.tx.manager.findOne(Channels, {
      where: { id: channelId, accountId, channelType: 'whatsapp' },
    });
    if (!channel) throw new NotFoundException('channel not found');
    return channel;
  }

  /** Sessão em memória do canal (cria a entrada se o processo ainda não conhece). */
  private async sessionOf(
    accountId: string,
    channelId: string,
  ): Promise<WaSession> {
    const channel = await this.channelOf(accountId, channelId);
    return this.sessions.ensure(channel.id, accountId, channel.name);
  }

  /** Canais + estado ao vivo (status, número, perfil) + contagens do banco. */
  async listSessions(accountId: string) {
    const channels = await this.listChannels(accountId);
    return Promise.all(
      channels.map(async (c) => {
        const s = this.sessions.get(c.id);
        const cfg = (c.config ?? {}) as Record<string, string | undefined>;
        const counts = await this.tx.manager
          .query<{ chats: string; messages: string }[]>(
            `SELECT count(DISTINCT conv.id)::text AS chats, count(m.id)::text AS messages
               FROM inboxes i
               LEFT JOIN conversations conv ON conv.inbox_id = i.id
               LEFT JOIN messages m ON m.conversation_id = conv.id
              WHERE i.channel_id = $1`,
            [c.id],
          )
          .catch(() => [{ chats: '0', messages: '0' }]);
        const phone = s?.phone ?? cfg.wa_phone ?? null;
        return {
          id: c.id,
          name: c.name,
          enabled: c.enabled,
          status:
            s?.status ??
            (cfg.wa_status as WaSession['status'] | undefined) ??
            'disconnected',
          phone,
          owner_jid: phone ? `${phone}@s.whatsapp.net` : null,
          profile_name: s?.profileName ?? cfg.wa_profile_name ?? null,
          profile_pic_url: null as string | null,
          counts: {
            contacts: s?.store.contacts.size ?? 0,
            chats: Number(counts[0]?.chats ?? 0),
            messages: Number(counts[0]?.messages ?? 0),
          },
        };
      }),
    );
  }

  /** Cria canal + inbox + sessão e já devolve o QR (quando o WhatsApp o gerar). */
  async provision(accountId: string, input: { channelName?: string }) {
    const name = input.channelName?.trim() || 'WhatsApp';
    const created = this.tx.manager.create(Channels, {
      accountId,
      channelType: 'whatsapp',
      name,
      config: { wa_status: 'disconnected' },
      enabled: true,
    });
    const channel = await this.tx.manager.save(Channels, created);
    await this.tx.manager.update(
      Channels,
      { id: channel.id },
      {
        config: { wa_channel_id: channel.id, wa_status: 'connecting' },
      },
    );

    const inbox = this.tx.manager.create(Inboxes, {
      accountId,
      channelId: channel.id,
      channelType: 'whatsapp',
      name,
    });
    await this.tx.manager.save(Inboxes, inbox);

    const s = this.sessions.ensure(channel.id, accountId, name);
    await this.sessions.start(channel.id);
    const qr = await this.waitForQr(s);
    return {
      ok: true,
      channel_id: channel.id,
      status: s.status,
      qrcode_base64: qr,
    };
  }

  private async waitForQr(s: WaSession): Promise<string | null> {
    const until = Date.now() + QR_WAIT_MS;
    while (Date.now() < until && !s.qr && s.status !== 'connected') {
      await new Promise((r) => setTimeout(r, 300));
    }
    return s.qr;
  }

  async getQrcode(accountId: string, channelId: string) {
    const s = await this.sessionOf(accountId, channelId);
    if (s.status === 'connected') return { base64: null, pairingCode: null };
    if (!s.sock) await this.sessions.start(channelId);
    const qr = await this.waitForQr(s);
    return { base64: qr, pairingCode: s.pairingCode };
  }

  async getStatus(accountId: string, channelId: string) {
    const s = await this.sessionOf(accountId, channelId);
    return { status: s.status, phone: s.phone, raw: s.status };
  }

  async requestPairingCode(
    accountId: string,
    channelId: string,
    phone: string,
  ) {
    await this.sessionOf(accountId, channelId);
    try {
      return { code: await this.sessions.requestPairingCode(channelId, phone) };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  async restart(accountId: string, channelId: string) {
    await this.sessionOf(accountId, channelId);
    await this.sessions.restart(channelId);
    return { ok: true };
  }

  async resync(accountId: string, channelId: string) {
    await this.sessionOf(accountId, channelId);
    return { ok: true, ...(await this.sessions.resync(channelId)) };
  }

  async logout(accountId: string, channelId: string) {
    await this.sessionOf(accountId, channelId);
    await this.sessions.logout(channelId);
    return { ok: true };
  }

  async updateChannel(
    accountId: string,
    channelId: string,
    dto: { name?: string; enabled?: boolean },
  ) {
    const channel = await this.channelOf(accountId, channelId);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (Object.keys(patch).length) {
      await this.tx.manager.update(Channels, { id: channel.id }, patch);
    }
    if (dto.enabled === false) await this.sessions.stop(channel.id);
    if (dto.enabled === true) {
      this.sessions.ensure(
        channel.id,
        accountId,
        dto.name?.trim() || channel.name,
      );
    }
    return { ok: true };
  }

  async deleteChannel(accountId: string, channelId: string) {
    const channel = await this.channelOf(accountId, channelId);
    await this.sessions.remove(channel.id);
    await this.tx.manager.delete(Channels, { id: channel.id });
    return { ok: true };
  }
}
