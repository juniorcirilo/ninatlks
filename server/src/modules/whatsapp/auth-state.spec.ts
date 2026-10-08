import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { useAtomicFileAuthState } from './auth-state';
import type { Baileys } from './baileys';

// Dublê mínimo do Baileys: o auth state só usa estas quatro peças.
const B = {
  BufferJSON: {
    // Igual ao BufferJSON real: JSON.stringify já chama Buffer#toJSON, então o
    // replacer recebe { type: 'Buffer', data: number[] }.
    replacer: (_k: string, v: unknown) => {
      const o = v as { type?: string; data?: unknown } | null;
      return o?.type === 'Buffer' && Array.isArray(o.data)
        ? {
            type: 'Buffer',
            data: Buffer.from(o.data as number[]).toString('base64'),
          }
        : v;
    },
    reviver: (_k: string, v: unknown) => {
      const o = v as { type?: string; data?: string } | null;
      return o?.type === 'Buffer' && typeof o.data === 'string'
        ? Buffer.from(o.data, 'base64')
        : v;
    },
  },
  initAuthCreds: () => ({ fresh: true }),
  proto: {
    Message: {
      AppStateSyncKeyData: { fromObject: (o: object) => ({ wrapped: o }) },
    },
  },
} as unknown as Baileys;

describe('useAtomicFileAuthState', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-auth-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('começa com credenciais novas e persiste/relê as chaves', async () => {
    const a = await useAtomicFileAuthState(dir, B);
    expect((a.state.creds as { fresh?: boolean }).fresh).toBe(true);

    await a.state.keys.set({
      'pre-key': {
        '1': { secret: Buffer.from('abc') },
        '2': { secret: Buffer.from('def') },
      },
    });
    await a.saveCreds();
    await a.flush();

    const b = await useAtomicFileAuthState(dir, B);
    const got = (await b.state.keys.get('pre-key', ['1', '2', '3'])) as Record<
      string,
      { secret: Buffer } | null
    >;
    expect(got['1']?.secret.toString()).toBe('abc');
    expect(got['2']?.secret.toString()).toBe('def');
    expect(got['3']).toBeNull();
  });

  it('valor null remove a chave do disco', async () => {
    const a = await useAtomicFileAuthState(dir, B);
    await a.state.keys.set({ session: { 'a/b:c': { v: 1 } } });
    const files = await fs.readdir(dir);
    expect(files).toContain('session-a__b-c.json'); // "/" e ":" são sanitizados
    await a.state.keys.set({ session: { 'a/b:c': null } });
    expect(await fs.readdir(dir)).not.toContain('session-a__b-c.json');
  });

  it('gravações concorrentes da mesma chave terminam consistentes e sem .tmp', async () => {
    const a = await useAtomicFileAuthState(dir, B);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        a.state.keys.set({ 'sender-key': { k: { n: i } } }),
      ),
    );
    await a.flush();
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const raw = JSON.parse(
      await fs.readFile(path.join(dir, 'sender-key-k.json'), 'utf8'),
    ) as {
      n: number;
    };
    expect(raw.n).toBe(24); // a última gravação vence (ordem preservada pela fila)
  });

  it('recupera as credenciais do backup quando creds.json está corrompido', async () => {
    const a = await useAtomicFileAuthState(dir, B);
    (a.state.creds as { me?: string }).me = 'v1';
    await a.saveCreds();
    (a.state.creds as { me?: string }).me = 'v2';
    await a.saveCreds(); // v1 vira creds.json.bak
    await a.flush();

    await fs.writeFile(path.join(dir, 'creds.json'), '{ truncado');
    const b = await useAtomicFileAuthState(dir, B);
    expect((b.state.creds as { me?: string }).me).toBe('v1');
  });
});
