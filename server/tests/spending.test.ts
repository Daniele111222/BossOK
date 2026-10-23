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

it('更正、退款和逻辑删除保留轨迹，重试不重复，旧版本不能覆盖', async () => {
  const f = await fixture();
  try {
    await f.app.inject({ method: 'POST', url: '/api/budget', headers: f.boss, payload: { daily: 8000, monthly: 200000, reason: '测试' } });
    const original = (await f.app.inject({ method: 'POST', url: '/api/expenses', headers: f.self, payload: { requestId: 'maintain-original', amount: 6500, category: '餐饮', spentOn: '2026-10-23', note: '' } })).json();
    const change = (kind: string, payload: object, headers = f.self, id = original.id) => f.app.inject({ method: 'POST', url: `/api/expenses/${id}/${kind}`, headers, payload });
    const edit = { requestId: 'edit-request-001', version: 1, amount: 7000, category: '餐饮', spentOn: '2026-10-23', note: '更正', reason: '漏计' };
    expect((await change('update', edit)).statusCode).toBe(200);
    expect((await change('update', edit)).json().version).toBe(2);
    expect((await change('update', { ...edit, requestId: 'edit-request-002' })).statusCode).toBe(409);
    expect((await change('update', { ...edit, version: 2 }, f.boss)).statusCode).toBe(403);
    expect((await change('update', { ...edit, version: 2 }, f.self, 'foreign')).statusCode).toBe(404);
    f.setDate('2026-11-01T04:00:00Z');
    const login = async (username: string) => ({ authorization: `Bearer ${(await f.app.inject({ method: 'POST', url: '/api/login', payload: { username, password: `password-test-${username}` } })).json().token}` });
    const self = await login('self'), boss = await login('boss');
    const refund = { requestId: 'refund-request-001', version: 2, amount: 2000, refundedOn: '2026-11-01', reason: '部分退款' };
    expect((await change('refunds', refund, self)).json().refunded).toBe(2000);
    expect((await change('refunds', refund, self)).json().refunded).toBe(2000);
    expect((await change('refunds', { ...refund, requestId: 'refund-request-002', version: 3, amount: 5001 }, self)).statusCode).toBe(409);
    expect((await change('update', { ...edit, requestId: 'edit-too-low', version: 3, amount: 1999 }, self)).statusCode).toBe(409);
    expect((await change('delete', { requestId: 'delete-refunded', version: 3, reason: '删除' }, self)).statusCode).toBe(409);
    expect((await change('refunds', { ...refund, requestId: 'refund-request-003', version: 3, amount: 1000 }, self)).json().refunded).toBe(3000);
    f.setDate('2026-10-23T04:00:00Z');
    expect((await f.app.inject({ url: '/api/balances', headers: boss })).json()).toMatchObject({ dailySpent: 4000, monthlySpent: 4000, dailyRemaining: 4000 });
    f.setDate('2026-11-02T04:00:00Z');
    expect((await change('update', { ...edit, requestId: 'invalid-refund-date', version: 4, spentOn: '2026-11-02' }, self)).statusCode).toBe(400);
    const detail = (await f.app.inject({ url: `/api/expenses/${original.id}`, headers: boss })).json();
    expect(detail.changes.map((c: { kind: string }) => c.kind)).toEqual(['update', 'refund', 'refund']);
    expect(detail.expense).toMatchObject({ amount: 7000, refunded: 3000, version: 4 });
    expect((await f.app.inject({ url: '/api/balances', headers: boss })).json().monthlySpent).toBe(0);
    const rows = (await f.app.inject({ url: '/api/expenses?month=2026-10', headers: self })).json();
    expect(rows.records[0].refunded).toBe(3000);
    const second = (await f.app.inject({ method: 'POST', url: '/api/expenses', headers: self, payload: { requestId: 'delete-original', amount: 100, category: '餐饮', spentOn: '2026-11-01', note: '' } })).json();
    expect((await change('delete', { requestId: 'delete-request-001', version: 1, reason: '误记' }, self, second.id)).json().deletedAt).toBeTypeOf('number');
    expect((await f.app.inject({ url: '/api/balances', headers: boss })).json().monthlySpent).toBe(0);
    expect((await f.app.inject({ url: `/api/expenses/${second.id}`, headers: boss })).json().changes[0].kind).toBe('delete');
  } finally { await f.close(); }
});

it('变更历史写入失败时账目和额度一起回滚', async () => {
  const f = await fixture();
  try {
    const payload = { requestId: 'rollback-original', amount: 6500, category: '餐饮', spentOn: '2026-10-23', note: '' };
    const original = (await f.app.inject({ method: 'POST', url: '/api/expenses', headers: f.self, payload })).json();
    f.db.exec("CREATE TRIGGER fail_change BEFORE INSERT ON expense_changes BEGIN SELECT RAISE(ABORT, 'test fault'); END");
    expect((await f.app.inject({ method: 'POST', url: `/api/expenses/${original.id}/delete`, headers: f.self, payload: { requestId: 'rollback-delete-01', version: 1, reason: '测试' } })).statusCode).toBe(500);
    const detail = (await f.app.inject({ url: `/api/expenses/${original.id}`, headers: f.boss })).json();
    expect(detail.expense).toMatchObject({ deletedAt: null, version: 1 }); expect(detail.changes).toEqual([]);
  } finally { await f.close(); }
});
