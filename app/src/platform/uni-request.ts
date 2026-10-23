import type { HttpTransport } from '../shared/http';

export const uniTransport: HttpTransport = (url, options) => new Promise((resolve, reject) => {
  uni.request({
    url,
    method: options?.method ?? 'GET',
    data: (options?.body ?? (options?.method === 'POST' ? {} : undefined)) as Record<string, unknown> | undefined,
    header: options?.token ? { Authorization: `Bearer ${options.token}` } : {},
    timeout: 10000,
    success(response) { resolve({ statusCode: response.statusCode, data: response.data }); },
    fail: reject
  });
});
