import { isHealthResponse, type HealthResponse } from '@bossok/contracts';
import { RequestError, type HttpRequest } from '../../shared/http/index.js';

export function createHealthClient(request: HttpRequest) {
  return {
    async check(): Promise<HealthResponse> {
      const data = await request('/health');
      if (!isHealthResponse(data)) {
        throw new RequestError('INVALID_RESPONSE', '服务返回的数据格式不正确');
      }
      return data;
    }
  };
}
