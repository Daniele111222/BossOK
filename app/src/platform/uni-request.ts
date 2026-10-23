import type { HttpTransport } from '../shared/http';

export const uniTransport: HttpTransport = (url) => new Promise((resolve, reject) => {
  uni.request({
    url,
    method: 'GET',
    timeout: 10000,
    success(response) { resolve({ statusCode: response.statusCode, data: response.data }); },
    fail: reject
  });
});
