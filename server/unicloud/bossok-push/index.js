const {timingSafeEqual,createHash}=require('node:crypto');
const reply=(statusCode,value)=>({statusCode,headers:{'content-type':'application/json'},body:JSON.stringify(value)});
exports.main=async event=>{
 const token=process.env.BOSSOK_PUSH_TOKEN,appid=process.env.BOSSOK_APPID;
 if(!token || token.length<32 || !appid) return reply(503,{accepted:false});
 const authorization=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1];
 const expected=Buffer.from(`Bearer ${token}`),actual=Buffer.from(typeof authorization==='string'?authorization:'');
 if(actual.length!==expected.length || !timingSafeEqual(actual,expected)) return reply(401,{accepted:false});
 if(event.httpMethod!=='POST') return reply(405,{accepted:false});
 try {
  const text=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString('utf8'):event.body;
  if(typeof text!=='string' || text.length>2048) return reply(400,{accepted:false});
  const body=JSON.parse(text);
  if(!body || !['id','cid','messageId'].every(key=>typeof body[key]==='string' && /^[a-zA-Z0-9_-]{8,128}$/.test(body[key])) || Object.keys(body).some(k=>!['id','cid','messageId'].includes(k))) return reply(400,{accepted:false});
  const receipts=uniCloud.database().collection('bossok-push-receipts'),receipt=await receipts.doc(body.id).get();
  if(receipt.data?.length) {
   const old=receipt.data[0];
   return old.cid===body.cid && old.messageId===body.messageId ? reply(200,{accepted:true}) : reply(409,{accepted:false});
  }
  const category=process.env.BOSSOK_PUSH_CATEGORY?JSON.parse(process.env.BOSSOK_PUSH_CATEGORY):undefined;
  const result=await uniCloud.getPushManager({appId:appid}).sendMessage({push_clientid:body.cid,title:'老板批了',content:'应用内有新消息，请打开查看',payload:{messageId:body.messageId},force_notification:true,request_id:createHash('sha256').update(body.id).digest('hex').slice(0,32),...(category?{category}:{})});
  if(!result || result.errCode!==0) return reply(502,{accepted:false});
  await receipts.add({_id:body.id,cid:body.cid,messageId:body.messageId,acceptedAt:Date.now()});
  return reply(200,{accepted:true});
 } catch {return reply(502,{accepted:false});}
};
