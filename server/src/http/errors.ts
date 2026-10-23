import type { FastifyInstance } from 'fastify';
import type { ErrorResponse } from '@bossok/contracts';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

export function registerErrorHandlers(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    const response: ErrorResponse = {
      code: 'NOT_FOUND', message: '请求的资源不存在', requestId: request.id
    };
    return reply.code(404).send(response);
  });

  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const statusCode = typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
    if (statusCode === 500) request.log.error({ err: error }, '请求处理失败');
    const response: ErrorResponse = {
      code: error instanceof HttpError ? error.code : statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: error instanceof HttpError ? error.message : statusCode === 500 ? '服务暂时不可用，请稍后重试' : '请求参数或格式不正确',
      requestId: request.id
    };
    return reply.code(statusCode).send(response);
  });
}
