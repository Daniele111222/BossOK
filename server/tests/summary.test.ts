import { expect, it } from 'vitest';
import { fixture } from './fixtures.js';

it('A11/A12：累计结余扣超支、无账目日按零支出，排除当天和预算前日期', async () => {
  const f=await fixture();
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    const summary=async(headers=f.self)=>(await f.app.inject({url:'/api/summary?month=2026-10',headers})).json();
    expect(await summary()).toMatchObject({eligibleDays:0,surplus:null});
    await post('/api/budget',{daily:8000,monthly:200000,reason:'测试'},f.boss);
    await post('/api/expenses',{requestId:'summary-before-001',amount:99900,category:'餐饮',spentOn:'2026-10-22',note:''});
    await post('/api/expenses',{requestId:'summary-day-one',amount:6000,category:'餐饮',spentOn:'2026-10-23',note:''});
    expect(await summary()).toMatchObject({eligibleDays:0,surplus:null});
    f.setDate('2026-10-24T04:00:00Z');
    await post('/api/expenses',{requestId:'summary-day-two',amount:9000,category:'餐饮',spentOn:'2026-10-24',note:''});
    await post('/api/expenses',{requestId:'summary-fixed-001',amount:5000,category:'生活缴费',spentOn:'2026-10-24',note:''});
    f.setDate('2026-10-25T04:00:00Z');
    expect(await summary()).toMatchObject({eligibleDays:2,metDays:1,budgetTotal:16000,countedSpent:15000,surplus:1000,totalSpent:20000,startDate:'2026-10-23',endDate:'2026-10-24'});
    expect(await summary(f.boss)).toEqual(await summary());
    f.setDate('2026-10-26T04:00:00Z');
    expect(await summary()).toMatchObject({eligibleDays:3,metDays:2,surplus:9000});
    const result=await summary();
    expect(result.categories.find((c:{category:string})=>c.category==='生活缴费')).toEqual({category:'生活缴费',amount:5000,countedAmount:0});
    for(const url of ['/api/summary','/api/summary?month=2026-13','/api/summary?month=2026-11','/api/summary?month=2026-10&relationshipId=other']) expect((await f.app.inject({url,headers:f.self})).statusCode).toBe(400);
    expect((await f.app.inject('/api/summary?month=2026-10')).statusCode).toBe(401);
  } finally {await f.close();}
});

it('历史额度/分类、负结余、补记更正删除、跨月退款和批准消费都按实际净额重算', async()=>{
  const f=await fixture();
  try {
    const post=(url:string,payload:object,headers=f.self)=>f.app.inject({method:'POST',url,payload,headers});
    const expense=async(requestId:string,amount:number,category='餐饮',spentOn='2026-10-23')=>(await post('/api/expenses',{requestId,amount,category,spentOn,note:''})).json();
    const get=async(headers=f.self)=>(await f.app.inject({url:'/api/summary?month=2026-10',headers})).json();
    await post('/api/budget',{daily:8000,monthly:200000,reason:'首次'},f.boss);
    const original=await expense('history-expense-001',9000);
    await post('/api/budget',{daily:10000,dailyCategories:['餐饮'],reason:'次日调整'},f.boss);
    f.setDate('2026-10-24T04:00:00Z');
    await expense('history-shopping-001',5000,'购物','2026-10-24');
    const a=(await post('/api/approvals',{requestId:'summary-approval-001',amount:11000,category:'餐饮',spentOn:'2026-10-24',purpose:'用品',reason:'需要'})).json();
    await post(`/api/approvals/${a.id}/actions`,{requestId:'summary-approve-001',action:'approve',opinion:''},f.boss);
    await post(`/api/approvals/${a.id}/confirm`,{requestId:'summary-confirm-001',amount:11000,spentOn:'2026-10-24',note:''});
    const rejected=(await post('/api/approvals',{requestId:'summary-rejected-001',amount:20000,category:'餐饮',spentOn:'2026-10-24',purpose:'用品',reason:'需要'})).json();
    await post(`/api/approvals/${rejected.id}/actions`,{requestId:'summary-reject-001',action:'reject',opinion:''},f.boss);
    const unconsumed=(await post('/api/approvals',{requestId:'summary-unconsumed-001',amount:20000,category:'餐饮',spentOn:'2026-10-24',purpose:'用品',reason:'需要'})).json();
    await post(`/api/approvals/${unconsumed.id}/actions`,{requestId:'summary-unconsumed-approved',action:'approve',opinion:''},f.boss);
    f.setDate('2026-10-25T04:00:00Z');
    expect(await get()).toMatchObject({budgetTotal:18000,countedSpent:20000,totalSpent:25000,surplus:-2000,metDays:0});
    const extra=await expense('history-late-001',1000,'餐饮','2026-10-23');
    expect((await get()).surplus).toBe(-3000);
    await post(`/api/expenses/${extra.id}/update`,{requestId:'summary-edit-001',version:1,amount:2000,category:'餐饮',spentOn:'2026-10-23',note:'',reason:'更正'});
    expect((await get()).surplus).toBe(-4000);
    await post(`/api/expenses/${extra.id}/delete`,{requestId:'summary-delete-001',version:2,reason:'误记'});
    expect((await get()).surplus).toBe(-2000);
    f.setDate('2026-11-01T04:00:00Z');
    const login=async(username:string)=>({authorization:`Bearer ${(await f.app.inject({method:'POST',url:'/api/login',payload:{username,password:`password-test-${username}`}})).json().token}`});
    const self=await login('self');
    expect((await post(`/api/expenses/${original.id}/refunds`,{requestId:'summary-refund-001',version:1,amount:3000,refundedOn:'2026-11-01',reason:'跨月退款'},self)).statusCode).toBe(200);
    const result=await get(self);
    expect(result).toMatchObject({eligibleDays:9,metDays:8,budgetTotal:88000,countedSpent:17000,surplus:71000,totalSpent:22000});
    expect(result.categories.find((c:{category:string})=>c.category==='购物')).toEqual({category:'购物',amount:5000,countedAmount:0});
    const {createSpendingClient}=await import('../../app/src/features/spending/index.js');
    const client=createSpendingClient(async()=>result);
    expect(await client.summary('token','2026-10')).toEqual(result);
    await expect(createSpendingClient(async()=>({...result,categories:[null]})).summary('token','2026-10')).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  }finally{await f.close();}
});
