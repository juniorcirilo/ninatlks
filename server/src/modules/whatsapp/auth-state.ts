import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Baileys } from './baileys';

/**
 * Estado de autenticação em arquivos, no formato do `useMultiFileAuthState`
 * do Baileys, mas seguro para produção:
 *  - escrita atômica (arquivo temporário + rename): um crash no meio nunca
 *    deixa um JSON truncado;
 *  - fila por arquivo: gravações concorrentes da mesma chave são serializadas;
 *  - `creds.json` mantém um backup (`creds.json.bak`) usado se o principal
 *    estiver corrompido.
 */
export async function useAtomicFileAuthState(dir: string, B: Baileys) {
  await fs.mkdir(dir, { recursive: true });

  const queues = new Map<string, Promise<void>>();
  const fileOf = (name: string) =>
    path.join(dir, name.replace(/\//g, '__').replace(/:/g, '-'));

  const enqueue = (file: string, job: () => Promise<void>): Promise<void> => {
    const prev = queues.get(file) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(job);
    queues.set(file, next);
    void next
      .finally(() => {
        if (queues.get(file) === next) queues.delete(file);
      })
      .catch(() => undefined);
    return next;
  };

  const atomicWrite = async (file: string, text: string) => {
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  };

  const readJson = async (file: string): Promise<unknown> => {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw, B.BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const writeData = (data: unknown, name: string) => {
    const file = fileOf(name);
    return enqueue(file, async () => {
      if (name === 'creds.json') {
        // Só promove a cópia anterior a backup se ela ainda for um JSON válido.
        const prev = await readJson(file);
        if (prev) {
          await fs.copyFile(file, `${file}.bak`).catch(() => undefined);
        }
      }
      await atomicWrite(file, JSON.stringify(data, B.BufferJSON.replacer));
    });
  };

  const removeData = (name: string) => {
    const file = fileOf(name);
    return enqueue(file, async () => {
      await fs.unlink(file).catch(() => undefined);
    });
  };

  const creds =
    ((await readJson(fileOf('creds.json'))) as ReturnType<
      Baileys['initAuthCreds']
    > | null) ??
    ((await readJson(`${fileOf('creds.json')}.bak`)) as ReturnType<
      Baileys['initAuthCreds']
    > | null) ??
    B.initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const data: Record<string, unknown> = {};
        await Promise.all(
          ids.map(async (id) => {
            let value = await readJson(fileOf(`${type}-${id}.json`));
            if (type === 'app-state-sync-key' && value) {
              value = B.proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }),
        );
        return data;
      },
      set: async (data: Record<string, Record<string, unknown>>) => {
        const jobs: Promise<void>[] = [];
        for (const category of Object.keys(data)) {
          for (const id of Object.keys(data[category])) {
            const value = data[category][id];
            const name = `${category}-${id}.json`;
            jobs.push(value ? writeData(value, name) : removeData(name));
          }
        }
        await Promise.all(jobs);
      },
    },
  };

  return {
    state,
    saveCreds: () => writeData(state.creds, 'creds.json'),
    /** Aguarda todas as gravações pendentes (usado no shutdown). */
    flush: async () => {
      await Promise.all(
        [...queues.values()].map((p) => p.catch(() => undefined)),
      );
    },
  };
}
