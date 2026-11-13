import { randomUUID } from 'node:crypto';
import type { Database } from '../../infrastructure/database/index.js';
import type { FastifyInstance } from 'fastify';
import {messagePageSchema,messageSchema,notificationPreferenceBodySchema,notificationPreferencesSchema,deviceBodySchema,type Message,type Balances} from '@bossok/contracts';
import type { IdentityService } from '../identity/index.js';
import {HttpError} from '../../http/errors.js';
export {createPushGateway,type PushSender,type PushJob} from './gateway.js';
import type {PushSender,PushJob} from './gateway.js';
const select=`SELECT id,approval_id AS "approvalId",title,created_at AS "createdAt",kind,scope,period,threshold,read_at AS "readAt",
 CASE WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='failed') THEN 'failed'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='pending') THEN 'pending'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='accepted') THEN 'accepted'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id) THEN 'skipped' ELSE 'not_registered' END AS "deliveryStatus" FROM messages`;
export function createNotifications(db:Database,now:()=>number,sender?:PushSender) {
 async function preferences(userId:string) {
  const row=await db.one('SELECT push_enabled FROM notification_preferences WHERE user_id=$1', userId) as {push_enabled:number}|undefined;
  return {pushEnabled:row?.push_enabled!==0,pushConfigured:!!sender};
 }
 async function write(recipientId:string,approvalId:string|null,title:string,budget?:{scope:'daily'|'monthly';period:string;threshold:80|100}) {
  const id=randomUUID();
  await db.run('INSERT INTO messages(id,recipient_id,approval_id,kind,title,created_at,scope,period,threshold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', id, recipientId, approvalId, budget?'budget':'approval', title, now(), budget?.scope??null, budget?.period??null, budget?.threshold??null);
  if((await preferences(recipientId)).pushEnabled) {
   const devices=await db.all('SELECT cid FROM push_devices WHERE user_id=$1 AND enabled=1 AND expires_at>$2', recipientId, now()) as {cid:string}[];
   for(const device of devices) await db.run("INSERT INTO push_deliveries(id,message_id,cid,status,next_attempt_at) VALUES($1,$2,$3,'pending',$4)", randomUUID(), id, device.cid, now());
  }
  return id;
 }
 async function thresholds(recipientIds:string[],date:string,balance:Balances) {
  for(const userId of recipientIds) for(const scope of ['daily','monthly'] as const) {
   const budget=balance.budget[scope];if(!budget) continue;
   const spent=scope==='daily'?balance.dailySpent:balance.monthlySpent,period=scope==='daily'?date:date.slice(0,7);
   const level=spent>=budget.amount?100:spent*100>=budget.amount*80?80:0;
   if(!level) continue;
   const previous=await db.one('SELECT level FROM notification_thresholds WHERE user_id=$1 AND scope=$2 AND period=$3', userId, scope, period) as {level:number}|undefined;
   if((previous?.level??0)>=level) continue;
   await db.run('INSERT INTO notification_thresholds(user_id,scope,period,level) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,scope,period) DO UPDATE SET level=excluded.level', userId, scope, period, level);
   await write(userId,null,`${scope==='daily'?'日额度':'月预算'}使用已达${level}%，请进入应用查看`,{scope,period,threshold:level});
  }
 }
 let timer:ReturnType<typeof setInterval>|undefined;
 let running:Promise<void>|undefined;
 function drain() {
  if(running) return running;
  running=(async()=>{
   if(!sender) return;
   const jobs=await db.all("SELECT d.id,d.cid,d.message_id AS \"messageId\",d.attempts,m.created_at FROM push_deliveries d JOIN messages m ON m.id=d.message_id WHERE d.status IN ('pending','failed') AND d.next_attempt_at<=$1 ORDER BY d.next_attempt_at,d.id LIMIT 20", now()) as (PushJob&{attempts:number;created_at:number})[];
   for(const job of jobs) {
    // 前一条投递等待期间，退出或偏好变更可能已撤销缓存中的后续任务。
    const device=await db.one("SELECT p.user_id,p.enabled,p.expires_at FROM push_devices p JOIN push_deliveries d ON d.cid=p.cid JOIN messages m ON m.id=d.message_id WHERE d.id=$1 AND d.status IN ('pending','failed') AND d.next_attempt_at<=$2 AND m.recipient_id=p.user_id", job.id, now()) as {user_id:string;enabled:number;expires_at:number}|undefined;
    if(!device || !device.enabled || device.expires_at<=now() || !(await preferences(device.user_id)).pushEnabled || job.created_at<now()-3*86400000) {
     await db.run("UPDATE push_deliveries SET status='skipped',last_error=NULL WHERE id=$1", job.id);continue;
    }
    try {await sender({id:job.id,cid:job.cid,messageId:job.messageId});await db.run("UPDATE push_deliveries SET status='accepted',attempts=attempts+1,last_error=NULL WHERE id=$1", job.id);}
    catch {await db.run("UPDATE push_deliveries SET status='failed',attempts=attempts+1,next_attempt_at=$1,last_error='PUSH_FAILED' WHERE id=$2", now()+Math.min(3600000,30000*2**Math.min(job.attempts,7)), job.id);}
   }
  })().finally(()=>{running=undefined;});
  return running;
 }
 function register(app:FastifyInstance,identity:IdentityService) {
  app.addHook('onReady',async()=>{timer=setInterval(()=>{void drain().catch(()=>app.log.error('通知投递队列处理失败'));},30000);timer.unref();});
  app.addHook('onResponse',async request=>{
   if(request.method!=='POST' || !sender) return;
   const logFailure=()=>app.log.error('通知投递队列处理失败');
   await running?.catch(logFailure);
   await drain().catch(logFailure);
  });
  async function get(userId:string,id:string):Promise<Message> {
   const row=await db.one(`${select} WHERE recipient_id=$1 AND id=$2`, userId, id) as Message|undefined;
   if(!row) throw new HttpError(404,'NOT_FOUND','消息不存在');return row;
  }
  app.get<{Querystring:{page?:number}}>('/api/messages',{schema:{response:{200:messagePageSchema},querystring:{type:'object',additionalProperties:false,properties:{page:{type:'integer',minimum:1,maximum:100000}}}}},async request=>{
   const actor=await identity.member(request),page=request.query.page??1,pageSize=20;
   const records=await db.all(`${select} WHERE recipient_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, actor.id, pageSize, (page-1)*pageSize);
   const counts=await db.one('SELECT count(*) AS total,count(*) FILTER (WHERE read_at IS NULL) AS unread FROM messages WHERE recipient_id=$1', actor.id) as {total:number;unread:number};
   return {records,...counts,page,pageSize};
  });
  app.get<{Params:{id:string}}>('/api/messages/:id',{schema:{response:{200:messageSchema}}},async request=>get((await identity.member(request)).id,request.params.id));
  app.post<{Params:{id:string}}>('/api/messages/:id/read',{schema:{response:{200:messageSchema}}},async request=>{
   const actor=await identity.member(request);await get(actor.id,request.params.id);
   await db.run('UPDATE messages SET read_at=COALESCE(read_at,$1) WHERE recipient_id=$2 AND id=$3', now(), actor.id, request.params.id);return get(actor.id,request.params.id);
  });
  app.get('/api/notification-preferences',{schema:{response:{200:notificationPreferencesSchema}}},async request=>preferences((await identity.member(request)).id));
  app.post<{Body:{pushEnabled:boolean}}>('/api/notification-preferences',{schema:{body:notificationPreferenceBodySchema,response:{200:notificationPreferencesSchema}}},async request=>{
   const actor=await identity.member(request);
   await db.transaction(async () =>{
    await db.run('INSERT INTO notification_preferences VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET push_enabled=excluded.push_enabled', actor.id, Number(request.body.pushEnabled));
    if(!request.body.pushEnabled) await db.run("UPDATE push_deliveries SET status='skipped' WHERE cid IN (SELECT cid FROM push_devices WHERE user_id=$1) AND status IN ('pending','failed')", actor.id);
   });return preferences(actor.id);
  });
  app.post<{Body:{cid:string;enabled:boolean}}>('/api/push-devices',{schema:{body:deviceBodySchema,response:{200:notificationPreferencesSchema}}},async request=>{
   return db.transaction(async () => {
    const session=await identity.session(request),body=request.body;
    await db.run('DELETE FROM push_devices WHERE expires_at<=$1', now());
    const existing=await db.one('SELECT user_id FROM push_devices WHERE cid=$1', body.cid) as {user_id:string}|undefined;
    if(existing && existing.user_id!==session.actor.id) throw new HttpError(409,'DEVICE_CONFLICT','设备仍绑定其他会话，请先退出原账号');
    const count=await db.one('SELECT count(*) AS count FROM push_devices WHERE user_id=$1', session.actor.id) as {count:number};
    if(!existing && count.count>=10) throw new HttpError(409,'DEVICE_LIMIT','设备登记已达上限，请退出旧设备');
    await db.run('INSERT INTO push_devices VALUES($1,$2,$3,$4,$5) ON CONFLICT(cid) DO UPDATE SET session_hash=excluded.session_hash,expires_at=excluded.expires_at,enabled=excluded.enabled', body.cid, session.actor.id, session.hash, session.expiresAt, Number(body.enabled));
    if(!body.enabled) await db.run("UPDATE push_deliveries SET status='skipped' WHERE cid=$1 AND status IN ('pending','failed')", body.cid);
    return preferences(session.actor.id);
   });
  });
  app.post('/api/notifications/retry',async request=>{
   const actor=await identity.member(request);
   await db.run("UPDATE push_deliveries SET next_attempt_at=$1 WHERE status='failed' AND cid IN (SELECT cid FROM push_devices WHERE user_id=$2)", now(), actor.id);
   return {ok:true};
  });
 }
 async function close() {if(timer) clearInterval(timer);await running;}
 return {write,thresholds,register,drain,close};
}
export type Notifications=ReturnType<typeof createNotifications>;
