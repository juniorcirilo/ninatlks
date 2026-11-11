import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Proteção SSRF para URLs configuradas por usuários (fontes de agente,
 * webhooks de saída, base URL de provedor de LLM).
 *
 * Hosts da rede interna (ex.: `http://n8n:5678`) continuam permitidos de
 * propósito; bloqueia-se o que nunca é destino legítimo: loopback (a própria
 * API/serviços locais), link-local (metadados de nuvem 169.254.169.254),
 * 0.0.0.0 e esquemas diferentes de http/https.
 */
function isBlockedIp(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isBlockedIp(mapped[1]);
  if (isIP(v) === 4) {
    const [a, b] = v.split('.').map(Number);
    return (
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      a >= 224 // multicast/reservado
    );
  }
  return (
    v === '::1' ||
    v === '::' ||
    v.startsWith('fe8') || v.startsWith('fe9') ||
    v.startsWith('fea') || v.startsWith('feb') || // fe80::/10
    v.startsWith('fd00:ec2') // metadados AWS IPv6
  );
}

export async function assertSafeOutboundUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL inválida.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Só http/https são permitidos.');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost') {
    throw new Error('Destino não permitido (localhost).');
  }
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error('Host não encontrado.');
      });
  if (addrs.some((a) => isBlockedIp(a.address))) {
    throw new Error('Destino não permitido (endereço interno/reservado).');
  }
  return u;
}
