import {expect,it} from 'vitest';
import {fixture} from './fixtures.js';
import {resetPassword} from '../src/modules/identity/index.js';
import {createNotifications,type PushJob} from '../src/modules/notifications/index.js';

it('重置密码撤销所有会话设备和待投递任务，保留应用内消息',async()=>{
 const sent:unknown[]=[];
 const f=await fixture({pushSender:async job=>{sent.push(job);throw new Error('provider down');}});
 try {
  const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
  await post('/api/budget',{daily:10000,monthly:200000,reason:'测试'},f.boss);
  await post('/api/push-devices',{cid:'reset-password-device',enabled:true});
  await post('/api/expenses',{requestId:'reset-warning-001',amount:8000,category:'餐饮',spentOn:'2026-10-23',note:''});
  expect(sent).toHaveLength(1);
  await resetPassword(f.db,'self','reset-password-self');
  expect((await f.app.inject({url:'/api/messages',headers:f.self})).statusCode).toBe(401);
  const token=(await post('/api/login',{username:'self',password:'reset-password-self'})).json().token;
  const headers={authorization:`Bearer ${token}`};
  await post('/api/notifications/retry',{},headers);
  expect(sent).toHaveLength(1);
  expect(f.db.prepare('SELECT count(*) AS count FROM push_devices').get()).toEqual({count:0});
  expect(f.db.prepare('SELECT count(*) AS count FROM push_deliveries').get()).toEqual({count:0});
  expect((await f.app.inject({url:'/api/messages',headers})).json()).toMatchObject({total:1,unread:1});
 }finally{await f.close();}
});

it('D09：实际支出80%/100%各一次，跨双档只发高档，修改/退款不重复，关闭推送仍留消息',async()=>{
 const f=await fixture();try{
  const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
  await post('/api/budget',{daily:10000,monthly:20000,reason:'测试'},f.boss);
  const create=async(requestId:string,amount:number)=>(await post('/api/expenses',{requestId,amount,category:'餐饮',spentOn:'2026-10-23',note:''})).json();
  const messages=async(headers=f.self)=>(await f.app.inject({url:'/api/messages',headers})).json();
  await post('/api/notification-preferences',{pushEnabled:false});
  const e=await create('threshold-first-001',8000);
  expect((await messages()).records).toEqual([expect.objectContaining({kind:'budget',period:'2026-10-23',threshold:80,scope:'daily',approvalId:null})]);
  await create('threshold-second-001',12000);
  const rows=(await messages()).records;
  expect(rows.filter((m:{scope:string})=>m.scope==='daily').map((m:{threshold:number})=>m.threshold).sort((a:number,b:number)=>a-b)).toEqual([80,100]);
  expect(rows.filter((m:{scope:string})=>m.scope==='monthly').map((m:{threshold:number})=>m.threshold)).toEqual([100]);
  await post(`/api/expenses/${e.id}/update`,{requestId:'threshold-shrink-001',version:1,amount:100,category:'餐饮',spentOn:'2026-10-23',note:'',reason:'更正'});
  await post(`/api/expenses/${e.id}/update`,{requestId:'threshold-grow-001',version:2,amount:8000,category:'餐饮',spentOn:'2026-10-23',note:'',reason:'更正'});
  expect((await messages()).total).toBe(3);expect((await messages(f.boss)).total).toBe(3);
  const id=rows[0].id;
  expect((await post(`/api/messages/${id}/read`,{})).statusCode).toBe(200);
  expect((await f.app.inject({url:`/api/messages/${id}`,headers:f.self})).json().readAt).toBeTypeOf('number');
  expect((await f.app.inject({url:`/api/messages/${id}`,headers:f.boss})).statusCode).toBe(404);
 }finally{await f.close();}
});

it('投递失败不撤销审批，重试与重启可恢复，禁用/退出/会话过期不再发给旧设备',async()=>{
 let fail=true;const sent:{id:string;cid:string;messageId:string}[]=[];
 const sender:import('../src/modules/notifications/index.js').PushSender=async job=>{if(fail)throw new Error('provider down');sent.push(job);};
 const f=await fixture({pushSender:sender});
 let restarted:ReturnType<typeof import('../src/app.js').buildApp>|undefined;
 try{
  const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
  await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
  expect((await post('/api/push-devices',{cid:'device-applicant-001',enabled:true})).statusCode).toBe(200);
  expect((await post('/api/push-devices',{cid:'device-applicant-001',enabled:true},f.boss)).statusCode).toBe(409);
  await post('/api/push-devices',{cid:'device-approver-001',enabled:true},f.boss);
  const a=(await post('/api/approvals',{requestId:'push-approval-001',amount:9000,category:'餐饮',spentOn:'2026-10-23',purpose:'需要',reason:'需要'})).json();
  await post(`/api/approvals/${a.id}/actions`,{requestId:'push-decision-001',action:'approve',opinion:''},f.boss);
  expect((await f.app.inject({url:`/api/approvals/${a.id}`,headers:f.self})).json().approval.status).toBe('approved');
  expect((await f.app.inject({url:'/api/messages',headers:f.self})).json().records[0].deliveryStatus).toBe('failed');
  fail=false;
  const {buildApp}=await import('../src/app.js');
  restarted=buildApp({databasePath:f.db.name,now:()=>Date.parse('2026-10-23T04:01:00Z'),pushSender:sender});
  await restarted.inject({method:'POST',url:'/api/notifications/retry',headers:f.self,payload:{}});
  expect(sent).toHaveLength(2);
  expect(sent.map(j=>j.cid).sort()).toEqual(['device-applicant-001','device-approver-001']);
  expect((await restarted.inject({url:'/api/messages',headers:f.self})).json().records[0].deliveryStatus).toBe('accepted');
  await restarted.close();restarted=undefined;
  fail=true;
  await post('/api/expenses',{requestId:'push-threshold-001',amount:9000,category:'餐饮',spentOn:'2026-10-23',note:''});
  await post('/api/notification-preferences',{pushEnabled:false});
  await post('/api/logout',{});
  const before=sent.length;fail=false;f.setDate('2026-10-24T04:00:00Z');
  await post('/api/notifications/retry',{},f.boss);
  expect(sent.slice(before).every(j=>j.cid==='device-approver-001')).toBe(true);
  expect((await f.app.inject({url:'/api/messages',headers:f.boss})).json().total).toBeGreaterThan(0);
  f.setDate('2026-11-01T04:00:00Z');
  expect((await post('/api/push-devices',{cid:'expired-device-001',enabled:true},f.boss)).statusCode).toBe(401);
 }finally{await restarted?.close();await f.close();}
});

it('提醒消息写入失败回滚记账，承诺和退款不触发新消费阈值，月份/日期独立',async()=>{
 const f=await fixture();try{
  const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
  await post('/api/budget',{daily:10000,monthly:20000,reason:'测试'},f.boss);
  const a=(await post('/api/approvals',{requestId:'commit-no-warning',amount:11000,category:'餐饮',spentOn:'2026-10-23',purpose:'需要',reason:'需要'})).json();
  await post(`/api/approvals/${a.id}/actions`,{requestId:'commit-approved-001',action:'approve',opinion:''},f.boss);
  const get=async()=>(await f.app.inject({url:'/api/messages',headers:f.self})).json().records.filter((r:{kind:string})=>r.kind==='budget');
  expect(await get()).toEqual([]);
  f.db.exec("CREATE TRIGGER fail_budget_warning BEFORE INSERT ON messages WHEN NEW.kind='budget' BEGIN SELECT RAISE(ABORT,'test failure'); END");
  const body={requestId:'threshold-rollback',amount:10000,category:'餐饮',spentOn:'2026-10-23',note:''};
  expect((await post('/api/expenses',body)).statusCode).toBe(500);
  expect((await f.app.inject({url:'/api/expenses?month=2026-10',headers:f.self})).json().total).toBe(0);
  f.db.exec('DROP TRIGGER fail_budget_warning');
  const expense=(await post('/api/expenses',body)).json();
  expect((await get()).map((m:{threshold:number})=>m.threshold)).toEqual([100]);
  await post(`/api/expenses/${expense.id}/refunds`,{requestId:'threshold-refund',version:1,amount:5000,refundedOn:'2026-10-23',reason:'退款'});
  expect((await get()).length).toBe(1);
  f.setDate('2026-10-24T04:00:00Z');
  await post('/api/expenses',{...body,requestId:'threshold-new-day',spentOn:'2026-10-24',amount:8000});
  expect((await get()).filter((m:{scope:string})=>m.scope==='daily')).toHaveLength(2);
  f.setDate('2026-11-01T04:00:00Z');
  const token=(await f.app.inject({method:'POST',url:'/api/login',payload:{username:'self',password:'password-test-self'}})).json().token;
  const fresh={authorization:`Bearer ${token}`};
  await post('/api/expenses',{...body,requestId:'threshold-new-month-80',spentOn:'2026-11-01',category:'生活缴费',amount:16000},fresh);
  await post('/api/expenses',{...body,requestId:'threshold-new-month-100',spentOn:'2026-11-01',category:'生活缴费',amount:4000},fresh);
  const november=(await f.app.inject({url:'/api/messages',headers:fresh})).json().records.filter((m:{scope:string;period:string})=>m.scope==='monthly' && m.period==='2026-11');
  expect(november.map((m:{threshold:number})=>m.threshold).sort((a:number,b:number)=>a-b)).toEqual([80,100]);
 }finally{await f.close();}
});

it('自然过期设备不占名额，同机重新登录其他账号可重新登记；有效绑定仍拒绝接管',async()=>{
 const f=await fixture();try{
  const register=(headers:typeof f.self)=>f.app.inject({method:'POST',url:'/api/push-devices',headers,payload:{cid:'same-phone-device',enabled:true}});
  expect((await register(f.self)).statusCode).toBe(200);
  expect((await register(f.boss)).statusCode).toBe(409);
  f.setDate('2026-11-01T04:00:00Z');
  const token=(await f.app.inject({method:'POST',url:'/api/login',payload:{username:'boss',password:'password-test-boss'}})).json().token;
  expect((await register({authorization:`Bearer ${token}`})).statusCode).toBe(200);
 }finally{await f.close();}
});

it('投递期间退出并换账号登记相同设备，不发送已经撤销的旧账号队列',async()=>{
 const f=await fixture(),sent:PushJob[]=[];
 let release!:()=>void,started!:()=>void;
 const blocked=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const notifications=createNotifications(f.db,()=>Date.parse('2026-10-23T04:00:00Z'),async job=>{
  sent.push(job);if(sent.length===1){started();await blocked;}
 });
 try{
  const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
  await post('/api/budget',{daily:10000,monthly:200000,reason:'测试'},f.boss);
  for(const cid of ['switch-device-001','switch-device-002']) await post('/api/push-devices',{cid,enabled:true});
  await post('/api/expenses',{requestId:'switch-account-warning',amount:8000,category:'餐饮',spentOn:'2026-10-23',note:''});
  expect(f.db.prepare('SELECT count(*) AS count FROM push_deliveries').get()).toEqual({count:2});
  const draining=notifications.drain();await entered;
  const otherCid=sent[0]!.cid==='switch-device-001'?'switch-device-002':'switch-device-001';
  expect((await post('/api/logout',{})).statusCode).toBe(200);
  expect((await post('/api/push-devices',{cid:otherCid,enabled:true},f.boss)).statusCode).toBe(200);
  release();await draining;
  expect(sent).toHaveLength(1);
 }finally{release();await notifications.close();await f.close();}
});
