import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { agentLlmProviderMeta } from './providers';

const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 15_000;

function resolveBaseUrl(providerId: string, baseUrlOverride?: string): string {
  const meta = agentLlmProviderMeta(providerId);
  const url = (baseUrlOverride || meta.defaultBaseUrl || '').trim().replace(/\/+$/, '');
  if (!url) {
    throw new BadRequestException(
      `Provedor "${meta.label}" precisa de uma Base URL (não tem endereço padrão).`,
    );
  }
  return url;
}

/**
 * Testa conexão + lista modelos por provedor. Roda no backend (não no
 * navegador) porque a maioria dessas APIs bloqueia CORS pra chamadas
 * client-side, e a API key não deveria trafegar por fora do backend mesmo
 * quando a origem permitisse.
 */
@Injectable()
export class AgentLlmProviderService {
  private readonly logger = new Logger(AgentLlmProviderService.name);

  async listModels(args: {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
  }): Promise<{ models: string[] }> {
    const meta = agentLlmProviderMeta(args.provider);
    const baseUrl = resolveBaseUrl(args.provider, args.baseUrl);
    const apiKey = (args.apiKey ?? '').trim();
    if (meta.requiresApiKey && !apiKey) {
      throw new BadRequestException(`Provedor "${meta.label}" exige API Key.`);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res =
        meta.kind === 'anthropic'
          ? await fetch(`${baseUrl}/v1/models`, {
              headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
              signal: ctrl.signal,
            })
          : await fetch(`${baseUrl}/models`, {
              headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
              signal: ctrl.signal,
            });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadRequestException(
          `${meta.label} respondeu HTTP ${res.status} ao listar modelos: ${body.slice(0, 200)}`,
        );
      }
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id?: string }>;
      };
      const models = Array.isArray(json.data)
        ? json.data.map((m) => m.id).filter((id): id is string => !!id)
        : [];
      return { models };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const name = (err as Error).name;
      throw new BadRequestException(
        name === 'AbortError'
          ? `${meta.label} não respondeu em ${TIMEOUT_MS / 1000}s.`
          : `Falha ao listar modelos de ${meta.label}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(args: {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    modelId: string;
  }): Promise<{ ok: true; message: string }> {
    const meta = agentLlmProviderMeta(args.provider);
    const baseUrl = resolveBaseUrl(args.provider, args.baseUrl);
    const apiKey = (args.apiKey ?? '').trim();
    if (meta.requiresApiKey && !apiKey) {
      throw new BadRequestException(`Provedor "${meta.label}" exige API Key.`);
    }
    if (!args.modelId.trim()) {
      throw new BadRequestException('Selecione um modelo antes de testar.');
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res =
        meta.kind === 'anthropic'
          ? await fetch(`${baseUrl}/v1/messages`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
              },
              body: JSON.stringify({
                model: args.modelId,
                max_tokens: 8,
                messages: [{ role: 'user', content: 'diga apenas "ok"' }],
              }),
              signal: ctrl.signal,
            })
          : await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: args.modelId,
                temperature: 0,
                max_tokens: 8,
                messages: [{ role: 'user', content: 'diga apenas "ok"' }],
              }),
              signal: ctrl.signal,
            });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new BadRequestException(
          `${meta.label} respondeu HTTP ${res.status}: ${body.slice(0, 300)}`,
        );
      }
      return { ok: true, message: `Conectado a ${meta.label} (${args.modelId}) com sucesso.` };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const name = (err as Error).name;
      throw new BadRequestException(
        name === 'AbortError'
          ? `${meta.label} não respondeu em ${TIMEOUT_MS / 1000}s.`
          : `Falha ao conectar em ${meta.label}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
