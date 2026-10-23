import { isErrorResponse } from '@bossok/contracts';

export type HttpTransport = (url: string) => Promise<{ statusCode: number; data: unknown }>;
export type HttpRequest = (path: string) => Promise<unknown>;

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 0,
    readonly requestId?: string
  ) { super(message); }
}

export function createHttpClient(options: { baseUrl: string; transport: HttpTransport }): HttpRequest {
  return async (path) => {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new RequestError('CONFIG_ERROR', '请先配置 VITE_API_BASE_URL 为手机可访问的服务地址');
    }
    let response: Awaited<ReturnType<HttpTransport>>;
    try {
      response = await options.transport(`${baseUrl}${path}`);
    } catch {
      throw new RequestError('NETWORK_ERROR', '无法连接服务，请检查网络和接口地址');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (isErrorResponse(response.data)) {
        throw new RequestError(response.data.code, response.data.message, response.statusCode, response.data.requestId);
      }
      throw new RequestError('HTTP_ERROR', '请求失败，请稍后重试', response.statusCode);
    }
    return response.data;
  };
}
