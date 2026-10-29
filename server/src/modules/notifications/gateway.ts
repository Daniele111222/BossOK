export interface PushJob {id:string;cid:string;messageId:string}
export type PushSender=(job:PushJob)=>Promise<void>;
export function createPushGateway(config:{url:string;token:string},request:typeof fetch=fetch):PushSender {
 return async job=>{
  const response=await request(config.url,{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`},body:JSON.stringify(job),signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error('PUSH_FAILED');
  const body=await response.json() as {accepted?:boolean}|null;
  if(!body || body.accepted!==true) throw new Error('PUSH_FAILED');
 };
}
