import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

it('配置默认值固定在 server 目录，并允许显式覆盖', () => {
  expect(readConfig({})).toEqual({
    host: '127.0.0.1', port: 3000,
    databasePath: fileURLToPath(new URL('../data/bossok.sqlite', import.meta.url))
  });
  expect(readConfig({ PORT: '4000', HOST: '0.0.0.0', DATABASE_PATH: ':memory:' }))
    .toEqual({ host: '0.0.0.0', port: 4000, databasePath: ':memory:' });
});

it.each(['0', '65536', '-1', '3.5', 'NaN', '3e3', '', ' 3000 '])('拒绝非法端口 %j', (PORT) => {
  expect(() => readConfig({ PORT })).toThrow('PORT');
});

it('拒绝空主机和数据库地址', () => {
  expect(() => readConfig({ HOST: ' ' })).toThrow('HOST');
  expect(() => readConfig({ DATABASE_PATH: '' })).toThrow('DATABASE_PATH');
});
