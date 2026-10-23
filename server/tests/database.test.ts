import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { openDatabase } from '../src/infrastructure/database/index.js';

it('SQLite 重启后保留数据，迁移幂等并执行约束', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bossok-'));
  const path = join(directory, 'nested', 'test.sqlite');
  try {
    const first = openDatabase(path);
    try {
      first.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
        .run('test-user', 'tester', 'test-only-hash');
      expect(() => first.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
        .run('another', 'tester', 'test-only-hash')).toThrow();
    } finally {
      first.close();
    }
    expect(first.open).toBe(false);
    const second = openDatabase(path);
    try {
      expect(second.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toEqual(
        ['001_users.sql', '002_identity.sql', '003_budgets.sql', '004_ledger.sql'].map((name) => ({ name })));
      expect(second.prepare('SELECT username FROM users WHERE id = ?').get('test-user'))
        .toEqual({ username: 'tester' });
      expect(second.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      second.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
