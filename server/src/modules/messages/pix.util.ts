import * as QRCode from 'qrcode';

export type PixKeyType = 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

export const PIX_KEY_LABEL: Record<PixKeyType, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  phone: 'Telefone',
  email: 'E-mail',
  random: 'Chave aleatória',
};

const tlv = (id: string, value: string): string =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

const ascii = (s: string, max: number): string =>
  s
    .normalize('NFD')
    .replace(/[^\x20-\x7E]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, max);

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function normalizePixKey(key: string, type: PixKeyType): string {
  const k = key.trim();
  switch (type) {
    case 'cpf':
    case 'cnpj':
      return k.replace(/\D/g, '');
    case 'phone': {
      const d = k.replace(/\D/g, '');
      return d.startsWith('55') && d.length >= 12 ? `+${d}` : `+55${d}`;
    }
    case 'email':
      return k.toLowerCase();
    default:
      return k;
  }
}

/** BR Code estático (copia e cola) do PIX. */
export function buildBrCode(args: {
  key: string;
  type: PixKeyType;
  name?: string;
  city?: string;
  amount?: string;
  description?: string;
}): string {
  const key = normalizePixKey(args.key, args.type);
  const amount = args.amount
    ? Number(args.amount.replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'))
    : 0;
  const account =
    tlv('00', 'BR.GOV.BCB.PIX') +
    tlv('01', key) +
    (args.description ? tlv('02', args.description.slice(0, 40)) : '');
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amount > 0 ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', ascii(args.name ?? '', 25) || 'RECEBEDOR') +
    tlv('60', ascii(args.city ?? '', 15) || 'BRASIL') +
    tlv('62', tlv('05', '***')) +
    '6304';
  return body + crc16(body);
}

export function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 480,
    type: 'png',
  });
}
