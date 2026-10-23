import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('../', import.meta.url));

export function readConfig(env: NodeJS.ProcessEnv) {
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 必须为 1 到 65535 之间的整数');
  }
  const host = (env.HOST ?? '127.0.0.1').trim();
  if (!host) throw new Error('HOST 不能为空');
  const databasePath = (env.DATABASE_PATH ?? 'data/bossok.sqlite').trim();
  if (!databasePath) throw new Error('DATABASE_PATH 不能为空');

  return {
    host,
    port,
    databasePath: databasePath === ':memory:' ? databasePath : resolve(serverRoot, databasePath)
  };
}
