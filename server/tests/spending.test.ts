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

it('记账余额、固定支出、超支保留标记、补记范围、分页筛选与幂等', async () => {
  const f = await fixture();
  try {
    const budget = (payload: object) => f.app.inject({ method: 'POST', url: '/api/budget', headers: f.boss, payload });
    await budget({ daily: 8000, monthly: 20000, reason: '测试预算' });
    const create = (requestId: string, amount: number, category = '餐饮', spentOn = '2026-10-23', headers = f.self) => f.app.inject({ method: 'POST', url: '/api/expenses', headers, payload: { requestId, amount, category, spentOn, note: '测试' } });
    const balance = async () => (await f.app.inject({ url: '/api/balances', headers: f.boss })).json();
    expect((await balance()).dailyRemaining).toBe(8000);
    expect((await create('entry-0001', 6500)).statusCode).toBe(200);
    expect((await balance()).dailyRemaining).toBe(1500);
    const exact = await create('entry-0002', 1500);
    expect(exact.json().unapproved).toBe(false); expect((await balance()).dailyRemaining).toBe(0);
    const over = await create('entry-0003', 1);
    expect(over.json().unapproved).toBe(true); expect((await balance()).dailyRemaining).toBe(-1);
    const retry = await Promise.all([create('entry-0003', 1), create('entry-0003', 1)]);
    expect(retry.map(r => r.json().id)).toEqual([over.json().id, over.json().id]);
    expect((await create('entry-0003', 2)).statusCode).toBe(409);
    expect((await create('entry-0004', 100, '生活缴费')).json().unapproved).toBe(false);
    expect((await balance()).dailyRemaining).toBe(-1); expect((await balance()).monthlySpent).toBe(8101);
    expect((await create('entry-0005', 12000, '生活缴费')).json().unapproved).toBe(true);
    expect((await balance()).monthlyRemaining).toBe(-101);
    expect((await create('entry-0006', 100000, '购物', '2026-10-22')).json().budgetApplicable).toBe(false);
    expect((await balance()).monthlySpent).toBe(20101);
    expect((await create('entry-0007', 100, '餐饮', '2026-10-23', f.boss)).statusCode).toBe(403);
    expect((await create('entry-0007', 100, '餐饮', '2026-10-24')).statusCode).toBe(400);
    expect((await create('entry-0007', 100, '未知')).statusCode).toBe(400);
    for (const amount of [-1, 0, 1.1, 100000001]) expect((await create('invalid-id', amount)).statusCode).toBe(400);
    for (const query of ['month=2026-13', 'month=2026-10&pageSize=101', 'month=2026-10&page=0', 'month=2026-10&relationshipId=other']) expect((await f.app.inject({ url: `/api/expenses?${query}`, headers: f.boss })).statusCode).toBe(400);
    const get = (headers = f.boss) => f.app.inject({ url: '/api/expenses?month=2026-10&pageSize=2&category=生活缴费', headers });
    const records = (await get()).json(); expect(records.total).toBe(2); expect(records.records).toHaveLength(2);
    expect((await get(f.self)).json()).toEqual(records);
    expect((await f.app.inject({ url: '/api/expenses?month=2026-09', headers: f.self })).json().total).toBe(0);
    await budget({ monthly: 30000, reason: '提高预算' });
    expect((await get()).json().records.find((r: { requestId: string }) => r.requestId === 'entry-0005').unapproved).toBe(true);
    expect((await f.app.inject('/api/expenses?month=2026-10')).statusCode).toBe(401);
  } finally { await f.close(); }
});

it('跨端客户端在服务已写入但响应丢失后重试同一笔，不重复扣款', async () => {
  const { createSpendingClient } = await import('../../app/src/features/spending/index.js');
  const { createHttpClient } = await import('../../app/src/shared/http/index.js');
  const { yuanToCents } = await import('@bossok/contracts');
  const f = await fixture();
  try {
    await f.app.inject({ method: 'POST', url: '/api/budget', headers: f.boss, payload: { daily: 8000, monthly: 200000, reason: '测试' } });
    let loseResponse = true;
    const client = createSpendingClient(createHttpClient({ baseUrl: 'http://test/api', transport: async (url, options) => {
      const response = await f.app.inject({ method: options?.method ?? 'GET', url: new URL(url).pathname + new URL(url).search, headers: { authorization: `Bearer ${options?.token}` }, payload: options?.body as object });
      if (options?.method === 'POST' && loseResponse) { loseResponse = false; throw new Error('connection lost'); }
      return { statusCode: response.statusCode, data: response.json() };
    } }));
    const token = f.self.authorization.slice(7);
    const body = { requestId: 'lost-response-0001', amount: yuanToCents('65.00'), category: '餐饮' as const, spentOn: '2026-10-23', note: '' };
    await expect(client.createExpense(token, body)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await client.createExpense(token, body);
    expect((await client.ledger(token, '2026-10')).total).toBe(1);
    expect((await client.balances(token)).dailyRemaining).toBe(1500);
    for (const value of ['0', '1.001', '-1', '1e2', '1000000.01', '']) expect(() => yuanToCents(value)).toThrow();
    expect(yuanToCents('0.01')).toBe(1);
  } finally { await f.close(); }
});

it('首次预算按消费日期生效，同日既有支出与预算前日期显示一致', async () => {
  const f = await fixture();
  try {
    const create = (requestId: string, spentOn: string) => f.app.inject({ method: 'POST', url: '/api/expenses', headers: f.self, payload: { requestId, spentOn, amount: 100, category: '餐饮', note: '' } });
    await create('before-budget-today', '2026-10-23');
    await create('before-budget-old', '2026-10-22');
    await f.app.inject({ method: 'POST', url: '/api/budget', headers: f.boss, payload: { daily: 8000, monthly: 200000, reason: '首次' } });
    const rows = (await f.app.inject({ url: '/api/expenses?month=2026-10', headers: f.self })).json().records;
    expect(rows.find((r: { requestId: string }) => r.requestId === 'before-budget-today').budgetApplicable).toBe(true);
    expect(rows.find((r: { requestId: string }) => r.requestId === 'before-budget-old').budgetApplicable).toBe(false);
    expect((await f.app.inject({ url: '/api/balances', headers: f.self })).json().monthlySpent).toBe(100);
  } finally { await f.close(); }
});
