import { Injectable, Scope } from '@nestjs/common';
import { TenantTxHost } from '../../common/tenant-tx.host';
import { SecretsService } from '../secrets/secrets.service';

export interface ProviderStatus {
  key: string;
  label: string;
  configured: boolean;
  ok: boolean | null;
  detail?: string;
  usage?: Record<string, string | number | null>;
}

export interface IntegrationsStatusReport {
  ok: boolean;
  providers: ProviderStatus[];
  nexus: {
    agents_total: number;
    agents_synced_to_el: number;
    numbers_total: number;
    numbers_ai_active: number;
    numbers_pinned: number;
  };
}

/**
 * Ported from supabase/functions/integrations-status/index.ts — pings each
 * external provider with the account's configured key and reports back
 * status/usage for the Settings → Integrações tab.
 */
@Injectable({ scope: Scope.REQUEST })
export class IntegrationsStatusService {
  constructor(
    private readonly tx: TenantTxHost,
    private readonly secrets: SecretsService,
  ) {}

  async check(accountId: string): Promise<IntegrationsStatusReport> {
    const [elevenlabs, twilio, evolution, deepgram] = await Promise.all([
      this.checkElevenLabs(accountId),
      this.checkTwilio(accountId),
      this.checkEvolution(accountId),
      this.checkDeepgram(accountId),
    ]);

    const personas = await this.tx.manager.query<
      { id: string; elevenlabs_agent_id: string | null }[]
    >(
      `SELECT id, elevenlabs_agent_id FROM agent_personas WHERE account_id = $1`,
      [accountId],
    );
    const numbers = await this.tx.manager.query<
      {
        id: string;
        elevenlabs_phone_number_id: string | null;
        pinned_persona_id: string | null;
      }[]
    >(
      `SELECT id, elevenlabs_phone_number_id, pinned_persona_id FROM phone_numbers WHERE account_id = $1`,
      [accountId],
    );

    return {
      ok: true,
      providers: [elevenlabs, twilio, evolution, deepgram],
      nexus: {
        agents_total: personas.length,
        agents_synced_to_el: personas.filter((p) => !!p.elevenlabs_agent_id)
          .length,
        numbers_total: numbers.length,
        numbers_ai_active: numbers.filter((n) => !!n.elevenlabs_phone_number_id)
          .length,
        numbers_pinned: numbers.filter((n) => !!n.pinned_persona_id).length,
      },
    };
  }

  private async checkElevenLabs(accountId: string): Promise<ProviderStatus> {
    const key =
      (await this.secrets.getInternal(accountId, 'elevenlabs', 'api_key')) ||
      process.env.ELEVENLABS_API_KEY ||
      '';
    if (!key)
      return {
        key: 'elevenlabs',
        label: 'ElevenLabs (voz)',
        configured: false,
        ok: null,
      };
    const trimmed = key.trim();
    try {
      const res = await fetch(
        'https://api.elevenlabs.io/v1/user/subscription',
        {
          headers: { 'xi-api-key': trimmed },
        },
      );
      if (!res.ok) {
        return {
          key: 'elevenlabs',
          label: 'ElevenLabs (voz)',
          configured: true,
          ok: false,
          detail: `HTTP ${res.status}`,
        };
      }
      const sub = (await res.json()) as {
        character_count?: number;
        character_limit?: number;
        tier?: string;
      };
      const used = sub.character_count ?? 0;
      const limit = sub.character_limit ?? 0;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
      const tier = sub.tier ?? 'free';
      return {
        key: 'elevenlabs',
        label: 'ElevenLabs (voz)',
        configured: true,
        ok: true,
        detail: `Plano ${tier} · ${pct}% usado`,
        usage: {
          plano: tier,
          caracteres_usados: used,
          caracteres_limite: limit,
          percentual: `${pct}%`,
        },
      };
    } catch (err) {
      return {
        key: 'elevenlabs',
        label: 'ElevenLabs',
        configured: true,
        ok: false,
        detail: String(err).slice(0, 120),
      };
    }
  }

  private async checkTwilio(accountId: string): Promise<ProviderStatus> {
    const bundle = await this.secrets.getInternalBulk(accountId, 'twilio');
    const sid = bundle.account_sid || process.env.TWILIO_ACCOUNT_SID || '';
    const token = bundle.auth_token || process.env.TWILIO_AUTH_TOKEN || '';
    if (!sid || !token)
      return {
        key: 'twilio',
        label: 'Twilio (telefonia)',
        configured: false,
        ok: null,
      };
    try {
      const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
      const [balanceRes, numbersRes] = await Promise.all([
        fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,
          { headers: { Authorization: auth } },
        ),
        fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=1`,
          {
            headers: { Authorization: auth },
          },
        ),
      ]);
      if (!balanceRes.ok) {
        return {
          key: 'twilio',
          label: 'Twilio (telefonia)',
          configured: true,
          ok: false,
          detail: `HTTP ${balanceRes.status}`,
        };
      }
      const balance = (await balanceRes.json()) as {
        balance?: string;
        currency?: string;
      };
      const numbers = (await numbersRes.json().catch(() => ({}))) as {
        meta?: { total?: number };
        incoming_phone_numbers?: unknown[];
      };
      const bal = parseFloat(balance.balance ?? '0');
      const currency = balance.currency ?? 'USD';
      return {
        key: 'twilio',
        label: 'Twilio (telefonia)',
        configured: true,
        ok: true,
        detail: `Saldo: ${currency} ${bal.toFixed(2)}${bal < 5 ? ' ⚠️ baixo' : ''}`,
        usage: {
          saldo: `${currency} ${bal.toFixed(2)}`,
          numeros:
            numbers.meta?.total ?? numbers.incoming_phone_numbers?.length ?? 0,
        },
      };
    } catch (err) {
      return {
        key: 'twilio',
        label: 'Twilio',
        configured: true,
        ok: false,
        detail: String(err).slice(0, 120),
      };
    }
  }

  private async checkDeepgram(accountId: string): Promise<ProviderStatus> {
    const key =
      (await this.secrets.getInternal(accountId, 'deepgram', 'api_key')) ||
      process.env.DEEPGRAM_API_KEY ||
      '';
    if (!key)
      return {
        key: 'deepgram',
        label: 'Deepgram (transcrição)',
        configured: false,
        ok: null,
      };
    try {
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${key}` },
      });
      if (!res.ok) {
        return {
          key: 'deepgram',
          label: 'Deepgram (transcrição)',
          configured: true,
          ok: false,
          detail: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as {
        projects?: unknown[];
      };
      const projects = Array.isArray(body.projects) ? body.projects.length : 0;
      return {
        key: 'deepgram',
        label: 'Deepgram (transcrição)',
        configured: true,
        ok: true,
        detail: `${projects} projeto${projects === 1 ? '' : 's'} acessível${projects === 1 ? '' : 'is'}`,
        usage: { projetos: projects },
      };
    } catch (err) {
      return {
        key: 'deepgram',
        label: 'Deepgram',
        configured: true,
        ok: false,
        detail: String(err).slice(0, 120),
      };
    }
  }

  private async checkEvolution(accountId: string): Promise<ProviderStatus> {
    const rows = await this.tx.manager.query<
      { config: Record<string, string> }[]
    >(
      `SELECT config FROM channels WHERE account_id = $1 AND channel_type = 'whatsapp' LIMIT 1`,
      [accountId],
    );
    const cfg = rows[0]?.config ?? {};
    if (!cfg.evolution_url || !cfg.evolution_api_key) {
      return {
        key: 'evolution',
        label: 'Evolution (WhatsApp Web)',
        configured: false,
        ok: null,
      };
    }
    try {
      const res = await fetch(
        `${cfg.evolution_url.replace(/\/$/, '')}/instance/fetchInstances`,
        {
          headers: { apikey: cfg.evolution_api_key },
        },
      );
      if (!res.ok) {
        return {
          key: 'evolution',
          label: 'Evolution (WhatsApp Web)',
          configured: true,
          ok: false,
          detail: `HTTP ${res.status}`,
        };
      }
      const list = (await res.json().catch(() => [])) as Array<{
        connectionStatus?: string;
        instance?: { state?: string };
      }>;
      const total = Array.isArray(list) ? list.length : 0;
      const connected = Array.isArray(list)
        ? list.filter((i) =>
            (i.connectionStatus ?? i.instance?.state ?? '')
              .toString()
              .includes('open'),
          ).length
        : 0;
      return {
        key: 'evolution',
        label: 'Evolution (WhatsApp Web)',
        configured: true,
        ok: true,
        detail: `${connected}/${total} conectada(s) · status: ${cfg.evolution_instance_status ?? '?'}`,
        usage: { instancias_total: total, instancias_conectadas: connected },
      };
    } catch (err) {
      return {
        key: 'evolution',
        label: 'Evolution',
        configured: true,
        ok: false,
        detail: String(err).slice(0, 120),
      };
    }
  }
}
