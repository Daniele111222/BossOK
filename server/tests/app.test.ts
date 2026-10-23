import { isErrorResponse } from '@bossok/contracts';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('应用 Interface', () => {
  it('健康检查保持原有契约，未知请求返回可追踪的错误', async () => {
    const app = buildApp({ databasePath: ':memory:' });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', service: 'bossok-api', database: 'ok' });
      const missing = await app.inject({ method: 'GET', url: '/api/unknown' });
      expect(missing.statusCode).toBe(404);
      expect(isErrorResponse(missing.json())).toBe(true);
      expect(missing.json()).toMatchObject({ code: 'NOT_FOUND' });
      expect(missing.json().requestId).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('隐藏内部异常，校验错误使用统一契约', async () => {
    const app = buildApp({ databasePath: ':memory:' });
    app.get('/test/failure', async () => { throw new Error('private-sql-and-path'); });
    app.get('/test/validation', {
      schema: { querystring: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } } }
    }, async () => ({}));
    try {
      const failure = await app.inject({ method: 'GET', url: '/test/failure' });
      expect(failure.statusCode).toBe(500);
      expect(isErrorResponse(failure.json())).toBe(true);
      expect(failure.json().code).toBe('INTERNAL_ERROR');
      expect(failure.body).not.toContain('private-sql-and-path');

      const invalid = await app.inject({ method: 'GET', url: '/test/validation?amount=wrong' });
      expect(invalid.statusCode).toBe(400);
      expect(isErrorResponse(invalid.json())).toBe(true);
      expect(invalid.json().code).toBe('INVALID_REQUEST');
    } finally {
      await app.close();
    }
  });
});
