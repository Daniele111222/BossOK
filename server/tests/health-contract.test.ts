import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthyResponse } from '@bossok/contracts';
import { createHealthClient } from '../../app/src/features/health/index.js';
import { createHttpClient, type HttpTransport } from '../../app/src/shared/http/index.js';
import { buildApp } from '../src/app.js';

describe('手机端到 HTTP/SQLite 的契约', () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it('通过测试 Adapter 穿过真实应用与数据库，成功和错误使用相同契约', async () => {
    const app = buildApp({ databasePath: ':memory:' });
    apps.push(app);
    const transport: HttpTransport = async (url) => {
      const response = await app.inject({ method: 'GET', url: new URL(url).pathname });
      return { statusCode: response.statusCode, data: response.json() };
    };
    const request = createHttpClient({ baseUrl: 'http://test.local/api/', transport });
    expect(await createHealthClient(request).check()).toEqual(healthyResponse);
    await expect(request('/missing')).rejects.toMatchObject({
      code: 'NOT_FOUND', statusCode: 404, requestId: expect.any(String)
    });
  });

  it.each([null, {}, 'html', { ...healthyResponse, database: 'wrong' }])('拒绝错误的成功响应 %j', async (data) => {
    const request = createHttpClient({ baseUrl: '/api', transport: async () => ({ statusCode: 200, data }) });
    await expect(createHealthClient(request).check()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('缺少配置不发送请求，网络失败与 HTTP 失败可区分', async () => {
    const transport = vi.fn<HttpTransport>();
    await expect(createHttpClient({ baseUrl: '', transport })('/health'))
      .rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    expect(transport).not.toHaveBeenCalled();

    transport.mockRejectedValueOnce(new Error('offline'));
    const request = createHttpClient({ baseUrl: '/api', transport });
    await expect(request('/health')).rejects.toMatchObject({ code: 'NETWORK_ERROR', statusCode: 0 });
    transport.mockResolvedValueOnce({ statusCode: 502, data: '<html>gateway</html>' });
    await expect(request('/health')).rejects.toMatchObject({ code: 'HTTP_ERROR', statusCode: 502 });
  });
});
