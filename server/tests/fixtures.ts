import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/infrastructure/database/index.js';
import { createAccount } from '../src/modules/identity/index.js';

export async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'spending-')), path = join(dir, 'test.sqlite');
  let clock = Date.parse('2026-10-23T04:00:00Z');
  const db = openDatabase(path);
  await createAccount(db, 'boss', 'approver', 'password-test-boss');
  await createAccount(db, 'self', 'applicant', 'password-test-self');
  const app = buildApp({ databasePath: path, now: () => clock });
  const login = async (username: string, password: string) => (await app.inject({ method: 'POST', url: '/api/login', payload: { username, password } })).json().token as string;
  const boss = { authorization: `Bearer ${await login('boss', 'password-test-boss')}` };
  const self = { authorization: `Bearer ${await login('self', 'password-test-self')}` };
  const invite = (await app.inject({ method: 'POST', url: '/api/invitations', headers: boss })).json();
  await app.inject({ method: 'POST', url: '/api/bind', headers: self, payload: { code: invite.code, acceptSharing: true } });
  return { app, db, boss, self, setDate: (date: string) => { clock = Date.parse(date); },
    async close() { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
