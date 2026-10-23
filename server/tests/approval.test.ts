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

it('批准后确认28元只生成唯一关联账目，重复与并发不重复扣费，取消不记账', async () => {
  const f=await fixture();
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
    await post('/api/expenses',{requestId:'confirm-baseline-001',amount:6500,category:'餐饮',spentOn:'2026-10-23',note:''});
    const input={requestId:'confirm-purchase-001',amount:3000,category:'餐饮',spentOn:'2026-10-23',purpose:'用品',reason:'需要'};
    const a=(await post('/api/approvals',input)).json();
    await post(`/api/approvals/${a.id}/actions`,{requestId:'confirm-approve-001',action:'approve',opinion:''},f.boss);
    const body={requestId:'confirm-actual-001',amount:2800,spentOn:'2026-10-23',note:'实际购买'};
    expect((await post(`/api/approvals/${a.id}/confirm`,body,f.boss)).statusCode).toBe(403);
    const first=await post(`/api/approvals/${a.id}/confirm`,body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({status:'consumed',expenseId:expect.any(String)});
    expect((await post(`/api/approvals/${a.id}/confirm`,{...body,amount:2801})).statusCode).toBe(409);
    const results=await Promise.all([post(`/api/approvals/${a.id}/confirm`,body),post(`/api/approvals/${a.id}/confirm`,{...body,requestId:'confirm-actual-002'})]);
    expect(results.map(r=>r.statusCode)).toEqual([200,409]);
    const ledger=(await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json();
    expect(ledger.total).toBe(2);expect(ledger.records.find((e:{approvalId:string})=>e.approvalId===a.id)).toMatchObject({amount:2800,unapproved:false,unapprovedAmount:0});
    expect((await f.app.inject({url:'/api/balances',headers:f.boss})).json()).toMatchObject({dailySpent:9300,dailyCommitted:0});
    const b=(await post('/api/approvals',{...input,requestId:'cancel-purchase-001'})).json();
    await post(`/api/approvals/${b.id}/actions`,{requestId:'cancel-approve-001',action:'approve',opinion:''},f.boss);
    expect((await post(`/api/approvals/${b.id}/cancel`,{requestId:'cancel-action-001',reason:'没有购买'})).json().status).toBe('cancelled');
    expect((await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json().total).toBe(2);
    expect((await post(`/api/approvals/${b.id}/confirm`,{...body,requestId:'cancelled-confirm-001'})).statusCode).toBe(409);
  } finally {await f.close();}
});

it('批准100实际120只记一笔，20差额补批只更新关联；缩额/退款不释放批准额度', async () => {
  const f=await fixture();
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
    const a=(await post('/api/approvals',{requestId:'over-purchase-001',amount:10000,category:'餐饮',spentOn:'2026-10-23',purpose:'购买',reason:'需要'})).json();
    await post(`/api/approvals/${a.id}/actions`,{requestId:'over-approve-001',action:'approve',opinion:''},f.boss);
    const confirmed=(await post(`/api/approvals/${a.id}/confirm`,{requestId:'over-confirm-001',amount:12000,spentOn:'2026-10-23',note:''})).json();
    const id=confirmed.expenseId;
    const get=async()=>(await f.app.inject({url:`/api/expenses/${id}`,headers:f.self})).json().expense;
    expect(await get()).toMatchObject({amount:12000,unapprovedAmount:2000,unapproved:true});
    const supplement={requestId:'over-supplement-001',version:1,reason:'真实差额'};
    expect((await post(`/api/expenses/${id}/supplements`,supplement,f.boss)).statusCode).toBe(403);
    const extra=(await post(`/api/expenses/${id}/supplements`,supplement)).json();
    expect(extra).toMatchObject({kind:'supplement',amount:2000,expenseId:id});
    expect((await post(`/api/expenses/${id}/supplements`,supplement)).json().id).toBe(extra.id);
    expect((await post(`/api/expenses/${id}/supplements`,{...supplement,requestId:'over-supplement-dup'})).statusCode).toBe(409);
    const decision={requestId:'over-supplement-approve',action:'approve',opinion:''};
    f.db.exec("CREATE TRIGGER fail_supplement BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'test fault'); END");
    expect((await post(`/api/approvals/${extra.id}/actions`,decision,f.boss)).statusCode).toBe(500);
    expect(await get()).toMatchObject({unapprovedAmount:2000,version:1});
    f.db.exec('DROP TRIGGER fail_supplement');
    expect((await post(`/api/approvals/${extra.id}/actions`,decision,f.boss)).statusCode).toBe(200);
    expect((await post(`/api/approvals/${extra.id}/actions`,decision,f.boss)).statusCode).toBe(200);
    expect(await get()).toMatchObject({amount:12000,unapprovedAmount:0,unapproved:false,version:2});
    expect((await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json().total).toBe(1);
    expect((await f.app.inject({url:'/api/balances',headers:f.boss})).json()).toMatchObject({dailySpent:12000,dailyCommitted:0,monthlyCommitted:0});
    const edit={requestId:'over-edit-shrink',version:2,amount:8000,category:'餐饮',spentOn:'2026-10-23',note:'',reason:'更正'};
    expect((await post(`/api/expenses/${id}/update`,edit)).json().unapprovedAmount).toBe(0);
    expect((await post(`/api/expenses/${id}/update`,{...edit,requestId:'over-edit-grow',version:3,amount:9000})).json().unapprovedAmount).toBe(1000);
    const stale=(await post(`/api/expenses/${id}/supplements`,{requestId:'stale-supplement-001',version:4,reason:'补批'})).json();
    await post(`/api/expenses/${id}/refunds`,{requestId:'linked-refund-001',version:4,amount:1000,refundedOn:'2026-10-23',reason:'退款'});
    expect((await post(`/api/approvals/${stale.id}/actions`,{requestId:'stale-approve-001',action:'approve',opinion:''},f.boss)).statusCode).toBe(409);
    expect((await post(`/api/expenses/${id}/delete`,{requestId:'linked-delete-001',version:5,reason:'误记'})).statusCode).toBe(409);
    expect((await post(`/api/expenses/${id}/update`,{...edit,requestId:'linked-under-refund',version:5,amount:999})).statusCode).toBe(409);
    f.setDate('2026-10-24T04:00:00Z');
    expect((await f.app.inject({url:`/api/approvals/${extra.id}`,headers:f.self})).json().approval.status).toBe('approved');
  } finally {await f.close();}
});

it('批准日真实消费可次日补记，跨日购买不能套用批准，改单不转移或恢复旧批准', async () => {
  const f=await fixture();
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
    await post('/api/expenses',{requestId:'date-base-expense',amount:6500,category:'餐饮',spentOn:'2026-10-23',note:''});
    const input={requestId:'date-purchase-001',amount:3000,category:'餐饮',spentOn:'2026-10-23',purpose:'购买',reason:'需要'};
    const a=(await post('/api/approvals',input)).json();
    await post(`/api/approvals/${a.id}/actions`,{requestId:'date-approve-001',action:'approve',opinion:''},f.boss);
    const pending=(await post('/api/approvals',{...input,requestId:'date-pending-001'})).json();
    f.setDate('2026-10-24T04:00:00Z');
    const body={requestId:'date-confirm-001',amount:2800,spentOn:'2026-10-24',note:''};
    expect((await post(`/api/approvals/${a.id}/confirm`,body)).statusCode).toBe(409);
    expect((await post(`/api/approvals/${pending.id}/confirm`,{...body,spentOn:'2026-10-23'})).statusCode).toBe(409);
    const confirmed=(await post(`/api/approvals/${a.id}/confirm`,{...body,spentOn:'2026-10-23'})).json();
    expect(confirmed.status).toBe('consumed');
    const id=confirmed.expenseId;
    const edit={requestId:'date-move-001',version:1,amount:2800,category:'餐饮',spentOn:'2026-10-24',note:'',reason:'纠正真实消费日'};
    expect((await post(`/api/expenses/${id}/update`,edit)).json().unapproved).toBe(false);
    const movedBack=(await post(`/api/expenses/${id}/update`,{...edit,requestId:'date-return-001',version:2,spentOn:'2026-10-23'})).json();
    expect(movedBack).toMatchObject({approvalId:a.id,unapproved:true,unapprovedAmount:2800});
    expect((await post(`/api/expenses/${id}/delete`,{requestId:'linked-delete-okay',version:3,reason:'误记'})).statusCode).toBe(200);
    expect((await f.app.inject({url:`/api/approvals/${a.id}`,headers:f.boss})).json()).toMatchObject({approval:{status:'consumed',expenseId:id},expense:{deletedAt:expect.any(Number)}});
    expect((await post(`/api/approvals/${a.id}/confirm`,{...body,spentOn:'2026-10-23',requestId:'deleted-reconfirm'})).statusCode).toBe(409);
    expect((await post('/api/expenses',{requestId:'unapproved-actual-001',amount:9000,category:'购物',spentOn:'2026-10-24',note:'已真实发生'})).json().unapproved).toBe(true);
  } finally {await f.close();}
});

it('消费确认账目/消息写入故障全部回滚；两连接并发仅一笔，响应丢失重试不重记', async () => {
  const f=await fixture();
  let second: ReturnType<typeof import('../src/app.js').buildApp> | undefined;
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
    const a=(await post('/api/approvals',{requestId:'fault-purchase-001',amount:10000,category:'餐饮',spentOn:'2026-10-23',purpose:'购买',reason:'需要'})).json();
    await post(`/api/approvals/${a.id}/actions`,{requestId:'fault-approve-001',action:'approve',opinion:''},f.boss);
    const body={requestId:'fault-confirm-001',amount:12000,spentOn:'2026-10-23',note:''};
    for (const table of ['expenses','messages']) {
      f.db.exec(`CREATE TRIGGER fail_confirm BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'test fault'); END`);
      expect((await post(`/api/approvals/${a.id}/confirm`,body)).statusCode).toBe(500);
      const detail=(await f.app.inject({url:`/api/approvals/${a.id}`,headers:f.boss})).json();
      expect(detail).toMatchObject({approval:{status:'approved',expenseId:null},expense:null});
      expect(detail.history.map((h:{action:string})=>h.action)).toEqual(['submit','approve']);
      expect((await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json().total).toBe(0);
      expect((await f.app.inject({url:'/api/balances',headers:f.self})).json()).toMatchObject({dailyCommitted:10000,dailySpent:0});
      f.db.exec('DROP TRIGGER fail_confirm');
    }
    const {buildApp}=await import('../src/app.js');
    second=buildApp({databasePath:f.db.name,now:()=>Date.parse('2026-10-23T04:00:00Z')});
    const results=await Promise.all([post(`/api/approvals/${a.id}/confirm`,body),second.inject({method:'POST',url:`/api/approvals/${a.id}/confirm`,headers:f.self,payload:{...body,requestId:'other-phone-confirm'}})]);
    expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
    const {createHttpClient}=await import('../../app/src/shared/http/index.js');
    const {createSpendingClient}=await import('../../app/src/features/spending/index.js');
    let lose=true;
    const client=createSpendingClient(createHttpClient({baseUrl:'http://test/api',transport:async(url,options)=>{
      const r=await f.app.inject({method:options?.method ?? 'GET',url:new URL(url).pathname+new URL(url).search,headers:f.self,payload:options?.body as object});
      if(lose){lose=false;throw new Error('lost response');}return {statusCode:r.statusCode,data:r.json()};
    }}));
    const b=(await post('/api/approvals',{requestId:'lost-purchase-001',amount:10000,category:'餐饮',spentOn:'2026-10-23',purpose:'购买',reason:'需要'})).json();
    await post(`/api/approvals/${b.id}/actions`,{requestId:'lost-approve-001',action:'approve',opinion:''},f.boss);
    const lostBody={...body,requestId:'lost-confirm-001'};
    await expect(client.confirmApproval('token',b.id,lostBody)).rejects.toMatchObject({code:'NETWORK_ERROR'});
    expect((await client.confirmApproval('token',b.id,lostBody)).status).toBe('consumed');
    expect((await client.ledger('token','2026-10')).total).toBe(2);
    expect((await client.balances('token')).dailySpent).toBe(24000);
  } finally {await second?.close();await f.close();}
});
