import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {messagePageSchema,messageSchema,notificationPreferenceBodySchema,notificationPreferencesSchema,deviceBodySchema,type Message,type Balances} from '@bossok/contracts';
import type { IdentityService } from '../identity/index.js';
import {HttpError} from '../../http/errors.js';
export {createPushGateway,type PushSender,type PushJob} from './gateway.js';
import type {PushSender,PushJob} from './gateway.js';
const select=`SELECT id,approval_id AS approvalId,title,created_at AS createdAt,kind,scope,period,threshold,read_at AS readAt,
 CASE WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='failed') THEN 'failed'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='pending') THEN 'pending'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id AND d.status='accepted') THEN 'accepted'
 WHEN EXISTS(SELECT 1 FROM push_deliveries d WHERE d.message_id=messages.id) THEN 'skipped' ELSE 'not_registered' END AS deliveryStatus FROM messages`;
export function createNotifications(db:Database.Database,now:()=>number,sender?:PushSender) {
 function preferences(userId:string) {
  const row=db.prepare('SELECT push_enabled FROM notification_preferences WHERE user_id=?').get(userId) as {push_enabled:number}|undefined;
  return {pushEnabled:row?.push_enabled!==0,pushConfigured:!!sender};
 }
 function write(recipientId:string,approvalId:string|null,title:string,budget?:{scope:'daily'|'monthly';period:string;threshold:80|100}) {
  const id=randomUUID();
  db.prepare('INSERT INTO messages(id,recipient_id,approval_id,kind,title,created_at,scope,period,threshold) VALUES(?,?,?,?,?,?,?,?,?)').run(id,recipientId,approvalId,budget?'budget':'approval',title,now(),budget?.scope??null,budget?.period??null,budget?.threshold??null);
  if(preferences(recipientId).pushEnabled) {
   const devices=db.prepare('SELECT cid FROM push_devices WHERE user_id=? AND enabled=1 AND expires_at>?').all(recipientId,now()) as {cid:string}[];
   for(const device of devices) db.prepare("INSERT INTO push_deliveries(id,message_id,cid,status,next_attempt_at) VALUES(?,?,?,'pending',?)").run(randomUUID(),id,device.cid,now());
  }
  return id;
 }
 function thresholds(recipientIds:string[],date:string,balance:Balances) {
  for(const userId of recipientIds) for(const scope of ['daily','monthly'] as const) {
   const budget=balance.budget[scope];if(!budget) continue;
   const spent=scope==='daily'?balance.dailySpent:balance.monthlySpent,period=scope==='daily'?date:date.slice(0,7);
   const level=spent>=budget.amount?100:spent*100>=budget.amount*80?80:0;
   if(!level) continue;
   const previous=db.prepare('SELECT level FROM notification_thresholds WHERE user_id=? AND scope=? AND period=?').get(userId,scope,period) as {level:number}|undefined;
   if((previous?.level??0)>=level) continue;
   db.prepare('INSERT INTO notification_thresholds(user_id,scope,period,level) VALUES(?,?,?,?) ON CONFLICT(user_id,scope,period) DO UPDATE SET level=excluded.level').run(userId,scope,period,level);
   write(userId,null,`${scope==='daily'?'日额度':'月预算'}使用已达${level}%，请进入应用查看`,{scope,period,threshold:level});
  }
 }
 let timer:ReturnType<typeof setInterval>|undefined;
 let running:Promise<void>|undefined;
 function drain() {
  if(running) return running;
  running=(async()=>{
   if(!sender) return;
   const jobs=db.prepare("SELECT d.id,d.cid,d.message_id AS messageId,d.attempts,m.created_at FROM push_deliveries d JOIN messages m ON m.id=d.message_id WHERE d.status IN ('pending','failed') AND d.next_attempt_at<=? ORDER BY d.next_attempt_at,d.id LIMIT 20").all(now()) as (PushJob&{attempts:number;created_at:number})[];
   for(const job of jobs) {
    // 前一条投递等待期间，退出或偏好变更可能已撤销缓存中的后续任务。
    const device=db.prepare("SELECT p.user_id,p.enabled,p.expires_at FROM push_devices p JOIN push_deliveries d ON d.cid=p.cid JOIN messages m ON m.id=d.message_id WHERE d.id=? AND d.status IN ('pending','failed') AND d.next_attempt_at<=? AND m.recipient_id=p.user_id").get(job.id,now()) as {user_id:string;enabled:number;expires_at:number}|undefined;
    if(!device || !device.enabled || device.expires_at<=now() || !preferences(device.user_id).pushEnabled || job.created_at<now()-3*86400000) {
     db.prepare("UPDATE push_deliveries SET status='skipped',last_error=NULL WHERE id=?").run(job.id);continue;
    }
    try {await sender({id:job.id,cid:job.cid,messageId:job.messageId});db.prepare("UPDATE push_deliveries SET status='accepted',attempts=attempts+1,last_error=NULL WHERE id=?").run(job.id);}
    catch {db.prepare("UPDATE push_deliveries SET status='failed',attempts=attempts+1,next_attempt_at=?,last_error='PUSH_FAILED' WHERE id=?").run(now()+Math.min(3600000,30000*2**Math.min(job.attempts,7)),job.id);}
   }
  })().finally(()=>{running=undefined;});
  return running;
 }
 function register(app:FastifyInstance,identity:IdentityService) {
  app.addHook('onReady',async()=>{timer=setInterval(()=>{void drain().catch(()=>app.log.error('通知投递队列处理失败'));},30000);timer.unref();});
  app.addHook('onResponse',async request=>{if(request.method==='POST') await drain().catch(()=>app.log.error('通知投递队列处理失败'));});
  function get(userId:string,id:string):Message {
   const row=db.prepare(`${select} WHERE recipient_id=? AND id=?`).get(userId,id) as Message|undefined;
   if(!row) throw new HttpError(404,'NOT_FOUND','消息不存在');return row;
  }
  app.get<{Querystring:{page?:number}}>('/api/messages',{schema:{response:{200:messagePageSchema},querystring:{type:'object',additionalProperties:false,properties:{page:{type:'integer',minimum:1,maximum:100000}}}}},async request=>{
   const actor=identity.member(request),page=request.query.page??1,pageSize=20;
   const records=db.prepare(`${select} WHERE recipient_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(actor.id,pageSize,(page-1)*pageSize);
   const counts=db.prepare('SELECT count(*) AS total,COALESCE(sum(read_at IS NULL),0) AS unread FROM messages WHERE recipient_id=?').get(actor.id) as {total:number;unread:number};
   return {records,...counts,page,pageSize};
  });
  app.get<{Params:{id:string}}>('/api/messages/:id',{schema:{response:{200:messageSchema}}},async request=>get(identity.member(request).id,request.params.id));
  app.post<{Params:{id:string}}>('/api/messages/:id/read',{schema:{response:{200:messageSchema}}},async request=>{
   const actor=identity.member(request);get(actor.id,request.params.id);
   db.prepare('UPDATE messages SET read_at=COALESCE(read_at,?) WHERE recipient_id=? AND id=?').run(now(),actor.id,request.params.id);return get(actor.id,request.params.id);
  });
  app.get('/api/notification-preferences',{schema:{response:{200:notificationPreferencesSchema}}},async request=>preferences(identity.member(request).id));
  app.post<{Body:{pushEnabled:boolean}}>('/api/notification-preferences',{schema:{body:notificationPreferenceBodySchema,response:{200:notificationPreferencesSchema}}},async request=>{
   const actor=identity.member(request);
   db.transaction(()=>{
    db.prepare('INSERT INTO notification_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET push_enabled=excluded.push_enabled').run(actor.id,Number(request.body.pushEnabled));
    if(!request.body.pushEnabled) db.prepare("UPDATE push_deliveries SET status='skipped' WHERE cid IN (SELECT cid FROM push_devices WHERE user_id=?) AND status IN ('pending','failed')").run(actor.id);
   })();return preferences(actor.id);
  });
  app.post<{Body:{cid:string;enabled:boolean}}>('/api/push-devices',{schema:{body:deviceBodySchema,response:{200:notificationPreferencesSchema}}},async request=>{
   const session=identity.session(request),body=request.body;
   db.prepare('DELETE FROM push_devices WHERE expires_at<=?').run(now());
   const existing=db.prepare('SELECT user_id FROM push_devices WHERE cid=?').get(body.cid) as {user_id:string}|undefined;
   if(existing && existing.user_id!==session.actor.id) throw new HttpError(409,'DEVICE_CONFLICT','设备仍绑定其他会话，请先退出原账号');
   const count=db.prepare('SELECT count(*) AS count FROM push_devices WHERE user_id=?').get(session.actor.id) as {count:number};
   if(!existing && count.count>=10) throw new HttpError(409,'DEVICE_LIMIT','设备登记已达上限，请退出旧设备');
   db.prepare('INSERT INTO push_devices VALUES(?,?,?,?,?) ON CONFLICT(cid) DO UPDATE SET session_hash=excluded.session_hash,expires_at=excluded.expires_at,enabled=excluded.enabled').run(body.cid,session.actor.id,session.hash,session.expiresAt,Number(body.enabled));
   if(!body.enabled) db.prepare("UPDATE push_deliveries SET status='skipped' WHERE cid=? AND status IN ('pending','failed')").run(body.cid);
   return preferences(session.actor.id);
  });
  app.post('/api/notifications/retry',async request=>{
   const actor=identity.member(request);
   db.prepare("UPDATE push_deliveries SET next_attempt_at=? WHERE status='failed' AND cid IN (SELECT cid FROM push_devices WHERE user_id=?)").run(now(),actor.id);
   return {ok:true};
  });
 }
 async function close() {if(timer) clearInterval(timer);await running;}
 return {write,thresholds,register,drain,close};
}
export type Notifications=ReturnType<typeof createNotifications>;
