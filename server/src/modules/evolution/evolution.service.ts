import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  Scope,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { Channels } from '../../database/entities/voice/channels.entity';
import { Inboxes } from '../../database/entities/voice/inboxes.entity';
import {
  EvolutionClientService,
  EvolutionError,
  instanceNameFor,
  normalizeStatus,
  type RemoteInstance,
} from './evolution-client.service';

interface EvolutionChannelConfig {
  evolution_url?: string;
  evolution_api_key?: string;
  evolution_instance_name?: string;
  evolution_instance_status?:
    'disconnected' | 'connecting' | 'qr_ready' | 'connected';
}

/** Ported from supabase/functions/evolution-{provision,qrcode,status,delete}. */
@Injectable({ scope: Scope.REQUEST })
export class EvolutionService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly client: EvolutionClientService,
    private readonly config: ConfigService,
  ) {}

  async listChannels(accountId: string) {
    return this.tx.manager.find(Channels, {
      where: { accountId, channelType: 'whatsapp' },
      select: { id: true, name: true, config: true, enabled: true },
      order: { createdAt: 'DESC' },
    });
  }

  /** Canais WhatsApp + dados ao vivo do Evolution (perfil, número, contagens). */
  async listSessions(accountId: string) {
    const channels = await this.listChannels(accountId);
    const servers = new Map<
      string,
      Promise<Map<string, Record<string, any>>>
    >();
    const load = (url: string, key: string) => {
      const k = `${url}|${key}`;
      if (!servers.has(k)) {
        servers.set(
          k,
          this.client
            .fetchInstances(url, key)
            .then(
              (l) =>
                new Map(
                  l.map((i) => [String(i.name ?? i.instanceName ?? ''), i]),
                ),
            ),
        );
      }
      return servers.get(k)!;
    };
    return Promise.all(
      channels.map(async (c) => {
        const cfg = (c.config ?? {}) as EvolutionChannelConfig;
        let remote: RemoteInstance | undefined;
        let error: string | undefined;
        if (cfg.evolution_url && cfg.evolution_api_key) {
          try {
            remote = (await load(cfg.evolution_url, cfg.evolution_api_key)).get(
              cfg.evolution_instance_name ?? '',
            );
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }
        return {
          id: c.id,
          name: c.name,
          enabled: c.enabled,
          instance_name: cfg.evolution_instance_name ?? null,
          url: cfg.evolution_url ?? null,
          status: remote
            ? normalizeStatus(remote.connectionStatus)
            : (cfg.evolution_instance_status ?? 'disconnected'),
          found: !!remote,
          error,
          profile_name: remote?.profileName ?? null,
          profile_pic_url: remote?.profilePicUrl ?? null,
          owner_jid: remote?.ownerJid ?? null,
          integration: remote?.integration ?? null,
          counts: {
            contacts: remote?._count?.Contact ?? 0,
            chats: remote?._count?.Chat ?? 0,
            messages: remote?._count?.Message ?? 0,
          },
        };
      }),
    );
  }

  async test(
    url: string,
    apiKey: string,
  ): Promise<{
    ok: boolean;
    instance_count?: number;
    error?: string;
    hint?: string;
  }> {
    try {
      const r = await this.client.ping(url.trim(), apiKey.trim());
      return { ok: true, instance_count: r.count };
    } catch (e) {
      const status = e instanceof EvolutionError ? e.status : 0;
      const hint =
        status === 403
          ? 'API key sem permissão. Use a global API key (AUTHENTICATION_API_KEY do .env do servidor Evolution) — não uma key escopada a instância.'
          : status === 401
            ? 'API key inválida ou ausente. Confira a AUTHENTICATION_API_KEY do servidor Evolution.'
            : 'Verifique a URL e a API key do servidor Evolution.';
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint,
      };
    }
  }

  async provision(
    accountId: string,
    input: {
      evolutionUrl?: string;
      evolutionApiKey?: string;
      instanceName?: string;
      channelId?: string;
      channelName?: string;
    },
  ) {
    const webhookSecret = this.config.get<string>('EVOLUTION_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new BadRequestException(
        'EVOLUTION_WEBHOOK_SECRET not configured on the server',
      );
    }
    const webhookUrl = `${this.config.get<string>('PUBLIC_API_URL')!.replace(/\/$/, '')}/webhooks/evolution/incoming`;

    let url = input.evolutionUrl?.trim();
    let apiKey = input.evolutionApiKey?.trim();
    if (!url || !apiKey) {
      // Reaproveita o servidor Evolution já configurado em outro canal da conta.
      const channels = await this.listChannels(accountId);
      const known = channels
        .map((c) => (c.config ?? {}) as EvolutionChannelConfig)
        .find((c) => c.evolution_url && c.evolution_api_key);
      url = url || known?.evolution_url;
      apiKey = apiKey || known?.evolution_api_key;
    }
    if (!url || !apiKey) {
      throw new BadRequestException(
        'Informe a URL e a API key do servidor Evolution.',
      );
    }

    let channelId = input.channelId;
    let existingInstanceName: string | undefined;

    if (channelId) {
      const existingChannel = await this.tx.manager.findOne(Channels, {
        where: { id: channelId, accountId },
      });
      if (!existingChannel)
        throw new NotFoundException('channel not found or not yours');
      existingInstanceName = (existingChannel.config as EvolutionChannelConfig)
        ?.evolution_instance_name;
    } else {
      const created = this.tx.manager.create(Channels, {
        accountId,
        channelType: 'whatsapp',
        name: input.channelName ?? 'WhatsApp (Evolution)',
        config: {
          evolution_url: url,
          evolution_api_key: apiKey,
          evolution_instance_status: 'connecting',
        },
        enabled: true,
      });
      const saved = await this.tx.manager.save(Channels, created);
      channelId = saved.id;
    }

    const customName = !existingInstanceName ? input.instanceName : undefined;
    let instanceName =
      existingInstanceName ??
      customName ??
      instanceNameFor(accountId, channelId.replace(/-/g, '').slice(0, 8));

    let provisioned:
      Awaited<ReturnType<EvolutionClientService['createInstance']>> | undefined;
    let lastErr: unknown;
    const maxAttempts = existingInstanceName || customName ? 1 : 4;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        provisioned = await this.client.createInstance({
          url,
          apiKey,
          instanceName,
          webhookUrl,
          webhookSecret,
        });
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = e;
        if (
          e instanceof EvolutionError &&
          e.code === 'ALREADY_EXISTS' &&
          attempt < maxAttempts - 1
        ) {
          const rand = Math.random().toString(36).slice(2, 8);
          instanceName = instanceNameFor(accountId, rand);
          continue;
        }
        break;
      }
    }

    if (!provisioned) {
      const status = lastErr instanceof EvolutionError ? lastErr.status : 500;
      const message =
        lastErr instanceof Error ? lastErr.message : String(lastErr);
      if (!input.channelId) {
        // Não deixa um canal órfão (sem instância) para trás.
        await this.tx.manager.delete(Channels, { id: channelId });
      }
      const text =
        lastErr instanceof EvolutionError && lastErr.code === 'ALREADY_EXISTS'
          ? `Já existe uma instância com o nome "${instanceName}" no Evolution.`
          : `Falha ao criar instância: ${message}`;
      if (status >= 400 && status < 500) throw new BadRequestException(text);
      throw new BadGatewayException(text);
    }

    const channelConfig: EvolutionChannelConfig = {
      evolution_url: url,
      evolution_api_key: apiKey,
      evolution_instance_name: provisioned.instanceName,
      evolution_instance_status: provisioned.qrcode?.base64
        ? 'qr_ready'
        : 'connecting',
    };

    await this.tx.manager.update(Channels, { id: channelId }, {
      config: channelConfig,
      name: input.channelName ?? 'WhatsApp (Evolution)',
      enabled: true,
    } as Record<string, unknown>);

    const inboxExisting = await this.tx.manager.findOne(Inboxes, {
      where: { channelId },
    });
    if (!inboxExisting) {
      const inbox = this.tx.manager.create(Inboxes, {
        accountId,
        channelId,
        channelType: 'whatsapp',
        name: input.channelName ?? 'WhatsApp',
      });
      await this.tx.manager.save(Inboxes, inbox);
    }

    return {
      ok: true,
      channel_id: channelId,
      instance_name: provisioned.instanceName,
      qrcode_base64: provisioned.qrcode?.base64 ?? null,
      status: channelConfig.evolution_instance_status,
    };
  }

  private async loadChannelConfig(
    accountId: string,
    channelId: string,
  ): Promise<{ channel: Channels; cfg: EvolutionChannelConfig }> {
    const channel = await this.tx.manager.findOne(Channels, {
      where: { id: channelId, accountId },
    });
    if (!channel) throw new NotFoundException('channel not found');
    const cfg = (channel.config ?? {}) as EvolutionChannelConfig;
    if (
      !cfg.evolution_url ||
      !cfg.evolution_api_key ||
      !cfg.evolution_instance_name
    ) {
      throw new BadRequestException('channel not provisioned for Evolution');
    }
    return { channel, cfg };
  }

  async getQrcode(accountId: string, channelId: string) {
    const { cfg } = await this.loadChannelConfig(accountId, channelId);
    const qr = await this.client.getQrCode({
      url: cfg.evolution_url!,
      apiKey: cfg.evolution_api_key!,
      instanceName: cfg.evolution_instance_name!,
    });
    return {
      base64: qr.base64 ?? null,
      pairingCode: qr.pairingCode ?? null,
      code: qr.code ?? null,
    };
  }

  async getStatus(accountId: string, channelId: string) {
    const { channel, cfg } = await this.loadChannelConfig(accountId, channelId);
    const state = await this.client.getConnectionState({
      url: cfg.evolution_url!,
      apiKey: cfg.evolution_api_key!,
      instanceName: cfg.evolution_instance_name!,
    });
    const normalized = normalizeStatus(state.instance?.state);

    if (cfg.evolution_instance_status !== normalized) {
      await this.tx.manager.update(
        Channels,
        { id: channel.id },
        {
          config: { ...cfg, evolution_instance_status: normalized },
        },
      );
    }
    return { status: normalized, raw: state.instance?.state ?? null };
  }

  async restart(accountId: string, channelId: string) {
    const { channel, cfg } = await this.loadChannelConfig(accountId, channelId);
    await this.client.restartInstance({
      url: cfg.evolution_url!,
      apiKey: cfg.evolution_api_key!,
      instanceName: cfg.evolution_instance_name!,
    });
    await this.tx.manager.update(
      Channels,
      { id: channel.id },
      { config: { ...cfg, evolution_instance_status: 'connecting' } },
    );
    return { ok: true };
  }

  async logout(accountId: string, channelId: string) {
    const { channel, cfg } = await this.loadChannelConfig(accountId, channelId);
    await this.client.logoutInstance({
      url: cfg.evolution_url!,
      apiKey: cfg.evolution_api_key!,
      instanceName: cfg.evolution_instance_name!,
    });
    await this.tx.manager.update(
      Channels,
      { id: channel.id },
      { config: { ...cfg, evolution_instance_status: 'disconnected' } },
    );
    return { ok: true };
  }

  async updateChannel(
    accountId: string,
    channelId: string,
    dto: { name?: string; enabled?: boolean },
  ) {
    const channel = await this.tx.manager.findOne(Channels, {
      where: { id: channelId, accountId, channelType: 'whatsapp' },
    });
    if (!channel) throw new NotFoundException('channel not found');
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (Object.keys(patch).length)
      await this.tx.manager.update(Channels, { id: channel.id }, patch);
    return { ok: true };
  }

  async deleteChannel(accountId: string, channelId: string) {
    const channel = await this.tx.manager.findOne(Channels, {
      where: { id: channelId, accountId },
    });
    if (!channel) throw new NotFoundException('channel not found');
    if (channel.channelType !== 'whatsapp') {
      throw new BadRequestException(
        'channel is not a whatsapp/evolution instance',
      );
    }

    const cfg = (channel.config ?? {}) as EvolutionChannelConfig;
    let remoteDeleted = false;
    let remoteError: string | undefined;
    if (
      cfg.evolution_url &&
      cfg.evolution_api_key &&
      cfg.evolution_instance_name
    ) {
      try {
        await this.client.deleteInstance({
          url: cfg.evolution_url,
          apiKey: cfg.evolution_api_key,
          instanceName: cfg.evolution_instance_name,
        });
        remoteDeleted = true;
      } catch (e) {
        remoteError =
          e instanceof EvolutionError
            ? `Evolution ${e.status}: ${e.body.slice(0, 200)}`
            : String(e);
      }
    }

    await this.tx.manager.delete(Channels, { id: channel.id });
    return {
      ok: true,
      remote_deleted: remoteDeleted,
      remote_error: remoteError,
    };
  }
}
