export function nativePushAvailable() {
 let available=false;
 // #ifdef APP-PLUS || APP-HARMONY
 available=true;
 // #endif
 return available;
}
export function notificationPermission():string {
 if(!nativePushAvailable()) return '当前浏览器不提供后台系统推送';
 try {
  const state=uni.getAppAuthorizeSetting().notificationAuthorized;
  return {authorized:'已授权',denied:'系统权限已关闭','not determined':'尚未授权','config error':'推送配置未完成'}[state] ?? '权限状态未知';
 } catch {return '尚不能读取系统权限';}
}
export function getPushClientId():Promise<string> {
 if(!nativePushAvailable()) return Promise.reject(new Error('需在已配置推送的手机应用中启用'));
 return new Promise((resolve,reject)=>uni.getPushClientId({success:res=>res.cid?resolve(res.cid):reject(new Error('尚未获取到推送标识')),fail:()=>reject(new Error('推送未配置或不可用，请核对手机配置'))}));
}
export function listenPush(open:(messageId?:string)=>void) {
 if(!nativePushAvailable()) return;
 uni.onPushMessage(event=>{
  if(event.type!=='click') return;
  let payload:unknown=event.data?.payload;
  if(typeof payload==='string') {try{payload=JSON.parse(payload);}catch{payload=null;}}
  const id=payload && typeof payload==='object' && 'messageId' in payload ? payload.messageId : null;
  open(typeof id==='string' && /^[a-zA-Z0-9_-]{8,80}$/.test(id)?id:undefined);
 });
}

export function notificationAllowed() {
 if(!nativePushAvailable()) return false;
 try {return uni.getAppAuthorizeSetting().notificationAuthorized==='authorized';} catch {return false;}
}
