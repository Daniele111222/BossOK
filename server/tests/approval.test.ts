import { expect, it } from 'vitest';
import { fixture } from './fixtures.js';

it('超支申请只一份，批准占完整承诺且不扣实际支出，消息和双角色同步', async () => {
  const f = await fixture();
  try {
    await f.app.inject({ method: 'POST', url: '/api/budget', headers: f.boss, payload: { daily: 8000, monthly: 20000, reason: '测试' } });
    await f.app.inject({ method: 'POST', url: '/api/expenses', headers: f.self, payload: { requestId: 'approval-spent-001', amount: 6500, category: '餐饮', spentOn: '2026-10-23', note: '' } });
    const body = { requestId: 'approval-request-001', amount: 3000, category: '餐饮', spentOn: '2026-10-23', purpose: '购买用品', reason: '临时需要' };
    const post = (url: string, payload: object, headers = f.self) => f.app.inject({ method: 'POST', url, headers, payload });
    const response = await post('/api/approvals', body);
    expect(response.statusCode).toBe(200);
    const approval = response.json(); expect(approval).toMatchObject({ status: 'pending', dailyOver: 1500, monthlyOver: 0 });
    expect((await post('/api/approvals', body)).json().id).toBe(approval.id);
    expect((await post('/api/approvals', { ...body, amount: 3001 })).statusCode).toBe(409);
    const action = { requestId: 'approval-decision-001', action: 'approve', opinion: '同意本次例外' };
    expect((await post(`/api/approvals/${approval.id}/actions`, action)).statusCode).toBe(403);
    expect((await post(`/api/approvals/${approval.id}/actions`, action, f.boss)).json().status).toBe('approved');
    expect((await post(`/api/approvals/${approval.id}/actions`, action, f.boss)).json().status).toBe('approved');
    expect((await post(`/api/approvals/${approval.id}/actions`, { ...action, requestId: 'conflict-decision', action: 'reject' }, f.boss)).statusCode).toBe(409);
    const balance = (await f.app.inject({ url: '/api/balances', headers: f.boss })).json();
    expect(balance).toMatchObject({ dailySpent: 6500, dailyCommitted: 3000, dailyRemaining: 1500, dailyAvailable: -1500, monthlyCommitted: 3000 });
    expect(balance.budget.daily.amount).toBe(8000);
    const expense = (await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json().records[0];
    expect((await post(`/api/expenses/${expense.id}/update`,{requestId:'commitment-edit-001',version:1,amount:6600,category:'餐饮',spentOn:'2026-10-23',note:'',reason:'更正'})).json().unapproved).toBe(true);
    expect((await f.app.inject({ url: '/api/messages', headers: f.boss })).json().records).toHaveLength(1);
    expect((await f.app.inject({ url: '/api/messages', headers: f.self })).json().records[0].approvalId).toBe(approval.id);
    expect((await f.app.inject({ url: '/api/approvals?month=2026-10', headers: f.self })).json()).toEqual((await f.app.inject({ url: '/api/approvals?month=2026-10', headers: f.boss })).json());
    f.setDate('2026-10-23T16:00:00Z');
    expect((await f.app.inject({ url: `/api/approvals/${approval.id}`, headers: f.self })).json().approval.status).toBe('expired');
    expect((await f.app.inject({ url: '/api/balances', headers: f.self })).json().monthlyCommitted).toBe(0);
  } finally { await f.close(); }
});

it('仅超月/同时超支、撤销重提、拒绝、并发冲突及过期符合角色状态', async () => {
  const f = await fixture();
  try {
    const post = (url: string, payload: object, headers = f.self) => f.app.inject({ method: 'POST', url, headers, payload });
    await post('/api/budget', { daily: 8000, monthly: 2000, reason: '测试' }, f.boss);
    const body = { requestId: 'monthly-only-001', amount: 3000, category: '生活缴费', spentOn: '2026-10-23', purpose: '缴费', reason: '真实需要' };
    expect((await post('/api/approvals/preview', body)).json()).toMatchObject({ dailyOver: 0, monthlyOver: 1000 });
    expect((await post('/api/approvals/preview', { ...body, amount: 9000, category: '餐饮' })).json()).toMatchObject({ dailyOver: 1000, monthlyOver: 7000 });
    expect((await post('/api/approvals', { ...body, spentOn: '2026-10-22' })).statusCode).toBe(400);
    expect((await post('/api/approvals', { ...body, amount: 2000 })).statusCode).toBe(409);
    expect((await post('/api/approvals', { ...body, role: 'approver' })).statusCode).toBe(400);
    expect((await post('/api/approvals', body, f.boss)).statusCode).toBe(403);
    const a = (await post('/api/approvals', body)).json();
    expect((await post(`/api/approvals/${a.id}/actions`, { requestId: 'withdraw-test-001', action: 'withdraw', opinion: '调整金额' })).json().status).toBe('withdrawn');
    const b = (await post('/api/approvals', { ...body, requestId: 'monthly-only-002', amount: 4000 })).json();
    const decisions = await Promise.all(['approve','reject'].map(action => post(`/api/approvals/${b.id}/actions`, { requestId: `race-request-${action}`, action, opinion: action },f.boss)));
    expect(decisions.map(r => r.statusCode).sort()).toEqual([200,409]);
    const c = (await post('/api/approvals', { ...body, requestId: 'monthly-only-003' })).json();
    expect((await post(`/api/approvals/${c.id}/actions`, { requestId: 'reject-test-001', action: 'reject', opinion: '暂缓' },f.boss)).json().status).toBe('rejected');
    const d = (await post('/api/approvals', { ...body, requestId: 'monthly-only-004' })).json();
    f.setDate('2026-10-23T16:00:00Z');
    expect((await post(`/api/approvals/${d.id}/actions`, { requestId: 'late-test-001', action: 'approve', opinion: '' },f.boss)).statusCode).toBe(409);
    expect((await f.app.inject({ url: `/api/approvals/${d.id}`, headers: f.boss })).json().approval).toMatchObject({ status:'expired', expiredFrom:'pending' });
    expect((await f.app.inject({ url: '/api/approvals/foreign', headers: f.boss })).statusCode).toBe(404);
    expect((await f.app.inject({ url: '/api/messages' })).statusCode).toBe(401);
  } finally { await f.close(); }
});

it('申请和审批的消息失败全部回滚，网络丢失可通过跨端客户端重试', async () => {
  const f = await fixture();
  try {
    const post = (url: string, payload: object, headers = f.self) => f.app.inject({ method: 'POST', url, payload, headers });
    await post('/api/budget', { daily: 8000, monthly: 20000, reason: '测试' }, f.boss);
    const body = { requestId: 'message-rollback-001', amount: 9000, category: '餐饮' as const, spentOn: '2026-10-23', purpose: '购买用品', reason: '临时需要' };
    f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'test fault'); END");
    expect((await post('/api/approvals',body)).statusCode).toBe(500);
    expect((await f.app.inject({url:'/api/approvals?month=2026-10',headers:f.self})).json().total).toBe(0);
    f.db.exec('DROP TRIGGER fail_message');
    const { createSpendingClient } = await import('../../app/src/features/spending/index.js');
    const { createHttpClient } = await import('../../app/src/shared/http/index.js');
    let lose = true;
    const client = createSpendingClient(createHttpClient({baseUrl:'http://test/api',transport:async(url,options)=>{
      const r=await f.app.inject({method:options?.method ?? 'GET',url:new URL(url).pathname+new URL(url).search,headers:{authorization:`Bearer ${options?.token}`},payload:options?.body as object});
      if(lose){lose=false;throw new Error('response lost');}
      return {statusCode:r.statusCode,data:r.json()};
    }}));
    const token=f.self.authorization.slice(7);
    await expect(client.createApproval(token,body)).rejects.toMatchObject({code:'NETWORK_ERROR'});
    const a=await client.createApproval(token,body);
    expect((await client.approvals(token,'2026-10')).total).toBe(1);
    f.db.exec("CREATE TRIGGER fail_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'test fault'); END");
    expect((await post(`/api/approvals/${a.id}/actions`,{requestId:'decision-rollback-001',action:'approve',opinion:''},f.boss)).statusCode).toBe(500);
    expect((await client.approval(token,a.id)).approval.status).toBe('pending');
    expect((await client.balances(token)).monthlyCommitted).toBe(0);
  } finally { await f.close(); }
});

it('畸形数组响应统一报告 INVALID_RESPONSE，不泄漏运行时类型异常', async () => {
  const { createSpendingClient } = await import('../../app/src/features/spending/index.js');
  const { createNotificationsClient } = await import('../../app/src/features/notifications/index.js');
  await expect(createNotificationsClient(async () => ({ records:[null],total:1,page:1,pageSize:20 })).list('token')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  const f=await fixture();
  try {
    const detail=(await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json();
    expect(detail.total).toBe(0);
    await f.app.inject({method:'POST',url:'/api/budget',headers:f.boss,payload:{daily:8000,monthly:20000,reason:'测试'}});
    const a=(await f.app.inject({method:'POST',url:'/api/approvals',headers:f.self,payload:{requestId:'malformed-test-001',amount:9000,category:'餐饮',spentOn:'2026-10-23',purpose:'测试',reason:'测试'}})).json();
    const valid=(await f.app.inject({url:`/api/approvals/${a.id}`,headers:f.self})).json();
    await expect(createSpendingClient(async()=>({...valid,history:[null]})).approval('token',a.id)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  } finally {await f.close();}
});
