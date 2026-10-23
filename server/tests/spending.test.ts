import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
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
it('预算权限、首次生效、次日调整、即时月预算、历史/跨月沿用和边界', async () => {
  const f = await fixture();
  try {
    const get = (date?: string, headers = f.boss) => f.app.inject({ url: `/api/budget${date ? `?date=${date}` : ''}`, headers });
    const save = (payload: object, headers = f.boss) => f.app.inject({ method: 'POST', url: '/api/budget', payload, headers });
    expect((await get()).json().daily).toBeNull();
    expect((await save({ daily: 8000, monthly: 200000, reason: '首次' }, f.self)).statusCode).toBe(403);
    expect((await save({ daily: 8000, reason: '首次' })).statusCode).toBe(400);
    for (const amount of [0, -1, 1.5, 100000001]) expect((await save({ daily: amount, monthly: 200000, reason: '非法' })).statusCode).toBe(400);
    expect((await save({ daily: 8000, monthly: 200000, reason: '首次' })).statusCode).toBe(200);
    expect((await get(undefined, f.self)).json()).toEqual((await get()).json());
    expect((await get('2026-10-22')).json().daily).toBeNull();
    expect((await get('2026-10-22')).json().monthly).toBeNull();
    expect((await save({ daily: 9000, monthly: 210000, dailyCategories: ['餐饮'], reason: '调整' })).statusCode).toBe(200);
    let current = (await get()).json();
    expect(current.daily.amount).toBe(8000); expect(current.monthly.amount).toBe(210000);
    f.setDate('2026-10-23T16:00:00Z'); // 上海跨日
    current = (await get()).json();
    expect(current.date).toBe('2026-10-24'); expect(current.daily.amount).toBe(9000); expect(current.daily.categories).toEqual(['餐饮']);
    expect((await get('2026-10-23')).json().daily.amount).toBe(8000);
    f.setDate('2026-11-01T04:00:00Z');
    const token = (await f.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'boss', password: 'password-test-boss' } })).json().token;
    current = (await get(undefined, { authorization: `Bearer ${token}` })).json();
    expect(current.daily.amount).toBe(9000); expect(current.monthly.amount).toBe(210000); expect(current.history).toHaveLength(4);
    for (const date of ['2026-02-30', '2026-99-99', '1999-12-31', '2027-01-01']) expect((await get(date, { authorization: `Bearer ${token}` })).statusCode).toBe(400);
  } finally { await f.close(); }
});
