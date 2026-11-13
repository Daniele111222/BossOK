export function readConfig(env: NodeJS.ProcessEnv) {
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 必须为 1 到 65535 之间的整数');
  }
  const host = (env.HOST ?? '127.0.0.1').trim();
  if (!host) throw new Error('HOST 不能为空');
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl) || !URL.canParse(databaseUrl)) {
    throw new Error('DATABASE_URL 必须是 PostgreSQL 连接地址');
  }

  const pushUrl=env.PUSH_GATEWAY_URL?.trim(),pushToken=env.PUSH_GATEWAY_TOKEN?.trim();
  if(!!pushUrl!==!!pushToken) throw new Error('PUSH_GATEWAY_URL 与 PUSH_GATEWAY_TOKEN 需同时配置');
  if(pushUrl) {
    const url=new URL(pushUrl);
    if(url.protocol!=='https:' || url.username || url.password || url.hash || !pushToken || pushToken.length<32) throw new Error('PUSH_GATEWAY 需要 HTTPS 地址和至少32字符密钥');
  }
  return {
    host,
    port,
    ...(pushUrl && pushToken ? {pushGateway:{url:pushUrl,token:pushToken}} : {}),
    databaseUrl
  };
}
